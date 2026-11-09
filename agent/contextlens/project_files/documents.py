"""Bounded, read-only text extraction for local project sources."""
import io
import os
import shutil
import stat
import subprocess
import zipfile
from xml.etree import ElementTree

from PIL import Image

TEXT_LIMIT = 2 * 1024 * 1024
DOCUMENT_LIMIT = 16 * 1024 * 1024
SKIP_DIRS = {"node_modules", "__pycache__", "venv", "dist", "build", "target", "Pods"}
BINARY_SUFFIXES = {".zip", ".gz", ".dmg", ".mp3", ".mp4", ".mov", ".wav", ".png", ".jpeg",
                   ".jpg", ".gif", ".webp", ".ico", ".sqlite", ".sqlite3", ".db", ".woff", ".woff2",
                   ".pem", ".key", ".p12", ".pyc", ".xlsx", ".pptx"}
IMAGE_FORMATS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".gif": "GIF", ".webp": "WEBP",
                 ".bmp": "BMP", ".ico": "ICO", ".tif": "TIFF", ".tiff": "TIFF", ".avif": "AVIF"}
IMAGE_SUFFIXES = IMAGE_FORMATS.keys() | {".svg"}
# Read as their extracted text; the only files split into passages and searched by content.
DOCUMENT_SUFFIXES = frozenset({".pdf", ".docx"})


def image_description(name, suffix, stream):
    if suffix == ".svg":
        # Inspect the root only; SVG source is never indexed as prose.
        for _, root in ElementTree.iterparse(stream, events=("start",)):
            if root.tag == "{http://www.w3.org/2000/svg}svg":
                return f"SVG image: {name}"
            break
        return ""
    with Image.open(stream, formats=[IMAGE_FORMATS[suffix]]) as image:
        return f"{image.format} image: {name} ({image.width} × {image.height})"


PDF_TOOL = shutil.which("pdftotext")


def files(root_fd):
    for directory, dirs, names, directory_fd in os.fwalk(".", dir_fd=root_fd, follow_symlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS)
        for name in sorted(names):
            if name.startswith("."):
                continue
            try:
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                yield os.path.relpath(os.path.join(directory, name)), directory_fd, info


def extract(name: str, directory_fd: int, size: int) -> str:
    suffix = os.path.splitext(name)[1].lower()
    limit = DOCUMENT_LIMIT if suffix in IMAGE_SUFFIXES | DOCUMENT_SUFFIXES else TEXT_LIMIT
    if size > limit or (suffix in BINARY_SUFFIXES and suffix not in IMAGE_SUFFIXES):
        return ""
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
        with os.fdopen(fd, "rb") as stream:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                return ""
            if suffix in IMAGE_SUFFIXES:
                return image_description(name, suffix, stream)
            beginning = stream.read(4096)
            utf16 = beginning.startswith((b"\xff\xfe", b"\xfe\xff"))
            if suffix not in DOCUMENT_SUFFIXES and not utf16 and b"\x00" in beginning:
                return ""
            raw = beginning + stream.read(limit + 1 - len(beginning))
        if len(raw) > limit:
            return ""
        if suffix == ".pdf":
            if not PDF_TOOL:
                return ""
            result = subprocess.run([PDF_TOOL, "-f", "1", "-l", "100", "-", "-"], input=raw,
                                    capture_output=True, timeout=8, check=True)
            return result.stdout[:TEXT_LIMIT].decode("utf-8", "replace")
        if suffix == ".docx":
            with zipfile.ZipFile(io.BytesIO(raw)) as doc:
                part = doc.getinfo("word/document.xml")
                if part.file_size > DOCUMENT_LIMIT:
                    return ""
                xml = ElementTree.fromstring(doc.read(part))
                ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                return "\n".join("".join(t.text or "" for t in p.iter(ns + "t")) for p in xml.iter(ns + "p"))[:TEXT_LIMIT]
        return raw.decode("utf-16" if utf16 else "utf-8-sig")
    except (Image.DecompressionBombError, OSError, UnicodeError, subprocess.SubprocessError, KeyError, ValueError, RuntimeError,
            zipfile.BadZipFile, ElementTree.ParseError):
        return ""
