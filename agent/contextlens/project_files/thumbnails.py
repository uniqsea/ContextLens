"""Local document thumbnails, resolved through the project's existing folder bindings."""
import base64
import io
import json
import os
import shutil
import stat
import subprocess
import textwrap
import unicodedata
from contextlib import ExitStack
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from threading import Lock

from PIL import Image, ImageOps

from contextlens.memory.store import session
from contextlens.memory.types import MemoryError
from .documents import DOCUMENT_LIMIT, IMAGE_FORMATS, extract
from .folders import file_stamp, open_root

# Coalesce concurrent misses without keeping a growing registry of file locks.
_RENDER_LOCKS = tuple(Lock() for _ in range(64))


class _HTMLText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"p", "div", "h1", "h2", "h3", "li", "br"} and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def _text_page(name, text):
    suffix = Path(name).suffix.lower()
    if suffix in {".html", ".htm"}:
        parser = _HTMLText()
        parser.feed(text)
        text = "".join(parser.parts)
    elif suffix == ".json":
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except ValueError:
            pass
    code = suffix in {".json", ".py", ".ts", ".js", ".tsx", ".jsx", ".css", ".svg", ".xml"}
    lines = []
    for line in text.splitlines():
        if len(lines) >= 24:
            break
        heading = suffix in {".md", ".markdown"} and line.startswith("#")
        clean = line.lstrip("#").strip() if heading else line.rstrip()
        wide = any(unicodedata.east_asian_width(c) in {"W", "F"} for c in clean)
        width = (18 if heading else 24) if wide else (30 if heading else 42)
        for part in textwrap.wrap(clean, width=width, replace_whitespace=False) or [""]:
            lines.append((part, heading))
    body = []
    y = 45
    for line, heading in lines[:24]:
        size = 17 if heading else 12
        body.append(f'<text x="25" y="{y}" font-size="{size}" font-weight="{600 if heading else 400}">{escape(line)}</text>')
        y += 25 if heading else 18
    font = "monospace" if code else "system-ui, sans-serif"
    page = (f'<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">'
            f'<rect width="360" height="480" fill="#fff"/><g fill="#282828" font-family="{font}">'
            + "".join(body) + '</g></svg>')
    return page.encode(), "image/svg+xml"


def _render(name, parent, stream, size):
    suffix = Path(name).suffix.lower()
    if suffix == ".svg":
        # Embed as an image resource, never as active same-origin markup.
        raw = stream.read(DOCUMENT_LIMIT + 1)
        if len(raw) > DOCUMENT_LIMIT:
            raise MemoryError("Document preview unavailable.")
        encoded = base64.b64encode(raw)
        return (b'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">'
                b'<image width="480" height="360" href="data:image/svg+xml;base64,' +
                encoded + b'"/></svg>'), "image/svg+xml"
    if suffix in IMAGE_FORMATS:
        with Image.open(stream, formats=[IMAGE_FORMATS[suffix]]) as image:
            image.thumbnail((480, 480))
            preview = ImageOps.exif_transpose(image).convert("RGBA")
            output = io.BytesIO()
            preview.save(output, "PNG")
            return output.getvalue(), "image/png"
    if suffix == ".pdf" and (renderer := shutil.which("pdftoppm")):
        rendered = subprocess.run([renderer, "-f", "1", "-singlefile", "-scale-to", "480", "-png", "-"],
                                  input=stream.read(DOCUMENT_LIMIT + 1), capture_output=True, check=True, timeout=8)
        return rendered.stdout, "image/png"
    text = extract(name, parent, size)
    if not text.strip():
        raise MemoryError("Document preview unavailable.")
    return _text_page(name, text[:12000])


def thumbnail(scope: str, source_id: str):
    with _RENDER_LOCKS[hash(source_id) % len(_RENDER_LOCKS)], session() as conn:
        rows = conn.execute("""SELECT f.*, d.path AS relative FROM project_documents d
            JOIN project_folders f ON f.id = d.folder_id WHERE f.project_id = ? AND d.source_id = ?
            ORDER BY f.path""", (scope, source_id)).fetchall()
        for row in rows:
            try:
                return _cached_preview(conn, row, source_id)
            except OSError:
                # The same file can also be reachable through a nested binding.
                continue
            except (Image.DecompressionBombError, ValueError, SyntaxError, subprocess.SubprocessError):
                break
        raise MemoryError("Document preview unavailable.")


def _cached_preview(conn, row, source_id):
    with open_root(row) as root, ExitStack() as stack:
        parent = root
        parts = Path(row["relative"]).parts
        for part in parts[:-1]:
            parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            stack.callback(os.close, parent)
        name = parts[-1]
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        stream = stack.enter_context(os.fdopen(fd, "rb"))
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > DOCUMENT_LIMIT:
            raise MemoryError("Document preview unavailable.")
        stamp = file_stamp(info)
        key = (row["id"], source_id, stamp)
        cached = conn.execute("""SELECT preview, preview_mime FROM project_documents
            WHERE folder_id = ? AND source_id = ? AND preview_stamp = ?""", key).fetchone()
        if cached is not None:
            return tuple(cached)

        data, mime = _render(name, parent, stream, info.st_size)
        if file_stamp(os.stat(name, dir_fd=parent, follow_symlinks=False)) != stamp:
            raise MemoryError("Document changed during preview.")
        saved = conn.execute("""UPDATE project_documents SET preview_stamp = ?, preview_mime = ?, preview = ?
            WHERE folder_id = ? AND source_id = ?""", (stamp, mime, data, row["id"], source_id))
        if not saved.rowcount:
            raise MemoryError("Document preview unavailable.")
        return data, mime
