"""Fictional documents authored in temporary directories for project file isolation tests."""
from pathlib import Path
from unittest.mock import patch

from langchain_core.messages import HumanMessage
from starlette.testclient import TestClient

from contextlens import memory, project_files
from contextlens.api import app
from contextlens.context import prepare_snapshot
from tests.support import StoreTestCase, USER


class ProjectFilesTests(StoreTestCase):
    def setUp(self):
        super().setUp()
        self.project = memory.operations.create_project("Fictional lighthouse", USER).id
        self.other = memory.operations.create_project("Fictional greenhouse", USER).id
        base = Path(self._tmp.name)
        self.first, self.second = base / "maps", base / "rules"
        self.first.mkdir()
        self.second.mkdir()
        (self.first / "nested").mkdir()
        self.plan = self.first / "nested" / "layout.md"
        self.plan.write_text("Fictional lanterns use indigo ink.")
        (self.second / "notes.txt").write_text("Lanterns light a fictional pier.")

    def search(self, question="lanterns"):
        snapshot = prepare_snapshot({"project_id": self.project, "messages": [HumanMessage(content=question)]})
        return [c for c in snapshot["candidates"] if c["layer"] == "retrieval"]

    def test_explicit_field_separates_relevance_from_membership_and_request_order(self):
        project_files.attach(self.project, [str(self.first), str(self.second)])
        (self.first / "unrelated.md").write_text("A fictional weather vane rotates clockwise.")
        (self.first / "opaque.png").write_bytes(b"\x00fictional binary")
        self.add("Fictional lanterns have a violet switch.", scope=self.project)
        other = self.add("Private scope fixture", scope=self.other)
        state = {"project_id": self.project, "messages": [HumanMessage(content="lanterns")], "input_order": []}
        preview = prepare_snapshot(state)
        files = {c["title"]: c for c in preview["candidates"] if c["layer"] == "retrieval"}
        self.assertEqual(set(files), {"maps/nested/layout.md", "maps/unrelated.md", "rules/notes.txt"})
        self.assertIsNone(files["maps/unrelated.md"]["retrieval_rank"])
        self.assertGreaterEqual(files["maps/nested/layout.md"]["retrieval_rank"], 1)
        [mem] = [c for c in preview["candidates"] if c["layer"] == "memory"]
        self.assertGreater(mem["relevance"], 0)
        self.assertEqual(preview["selected_ids"], ["sys-001", "usr-001"])
        self.assertEqual(preview["file_dependencies"], [])
        chosen = [files["maps/unrelated.md"]["id"], mem["id"], files["rules/notes.txt"]["id"]]
        for order in [chosen, list(reversed(chosen))]:
            result = prepare_snapshot({**state, "input_order": [*order, order[0], other]})
            self.assertEqual(result["input_order"], order)
            self.assertEqual(result["selected_ids"], ["sys-001", *order, "usr-001"])
            prompt = result["messages"][0]["content"]
            short = {real: label for label, real in result["labels"].items()}
            positions = [prompt.index(f"[{short[source_id]}]") for source_id in order]
            self.assertEqual(positions, sorted(positions))
            self.assertNotIn("indigo ink", prompt)
            self.assertNotIn("Private scope fixture", prompt)
            self.assertEqual({d["path"] for d in result["file_dependencies"]}, {"unrelated.md", "notes.txt"})
            self.assertEqual(next(c for c in result["candidates"] if c["id"] == mem["id"])["relevance"], mem["relevance"])

    def test_field_ids_survive_query_changes_with_overlapping_folders(self):
        project_files.attach(self.project, [str(self.first), str(self.first / "nested")])
        empty = {"project_id": self.project, "input_order": [], "messages": []}
        [file] = [c for c in prepare_snapshot(empty)["candidates"] if c["layer"] == "retrieval"]
        for question in ["layout", "lanterns", "unrelated"]:
            snapshot = prepare_snapshot({**empty, "input_order": [file["id"]],
                                         "messages": [HumanMessage(content=question)]})
            self.assertEqual(snapshot["input_order"], [file["id"]])
            self.assertEqual(len(snapshot["file_dependencies"]), 1)

    def files(self, scope=None, excluded=()):
        from contextlens.project_files.backend import ProjectFiles, View

        view = View(scope or self.project, set(excluded))
        return ProjectFiles(current=lambda: view), view

    def test_file_backend_is_scoped_read_only_and_honours_exclusions(self):
        from contextlens.project_files.backend import READ_ONLY

        (self.first / "alias.md").symlink_to(self.second / "notes.txt")
        project_files.attach(self.project, [str(self.first), str(self.second)])
        notes = next(d for d in self.search() if d["title"] == "rules/notes.txt")
        files, view = self.files(excluded={notes["id"]})
        self.assertEqual([e["path"] for e in files.ls("/").entries], ["/maps/", "/rules/"])
        self.assertEqual(files.read("/maps/nested/layout.md").file_data["content"], "Fictional lanterns use indigo ink.")
        # Excluded from the turn, reached through a symlink, or outside the folder: as if not there.
        for path in ("/rules/notes.txt", "/maps/alias.md", "/maps/../rules/notes.txt"):
            self.assertIsNotNone(files.read(path).error)
        self.assertEqual({m["path"] for m in files.grep("anterns").matches}, {"/maps/nested/layout.md"})
        self.assertEqual([m["path"] for m in files.glob("*.md").matches], ["/maps/nested/layout.md"])
        self.assertEqual(files.write("/maps/new.md", "x").error, READ_ONLY)
        self.assertEqual(files.edit("/maps/nested/layout.md", "indigo", "red").error, READ_ONLY)
        self.assertEqual(self.plan.read_text(), "Fictional lanterns use indigo ink.")
        other, _ = self.files(self.other)
        self.assertEqual(other.ls("/").entries, [])
        self.assertEqual(other.grep("anterns").matches, [])

    def test_agent_is_offered_file_tools_that_only_read(self):
        from langgraph.checkpoint.memory import InMemorySaver

        from contextlens import models
        from contextlens.graph import _builder
        from tests.support import ScriptedModel, reading, structured

        offered = []

        class Recording(ScriptedModel):
            def bind_tools(self, tools, **kwargs):
                offered.append({t["name"] if isinstance(t, dict) else t.name for t in tools})
                return self

        project_files.attach(self.project, [str(self.first)])
        agent = Recording(replies=["Done."], calls=[])
        writer = ScriptedModel(replies=[reading("reading a fictional plan"), structured("Lessons", lessons=[])], calls=[])
        models.use(lambda role: writer if role == "memory" else agent)
        _builder.compile(checkpointer=InMemorySaver()).invoke(
            {"messages": [HumanMessage(content="lanterns")], "project_id": self.project},
            {"configurable": {"thread_id": "fictional-tools"}})
        self.assertTrue({"ls", "read_file", "grep", "glob"} <= offered[0])
        self.assertFalse({"write_file", "edit_file", "delete", "execute", "browse_project_files"} & offered[0])
        self.assertIn("/projects/", agent.calls[0][0].content)

    def test_multi_folder_picker_and_live_scoped_retrieval(self):
        client = TestClient(app)
        url = f"/lens/projects/{self.project}/folders"
        with patch("contextlens.project_files.folders.sys.platform", "darwin"), patch(
                "contextlens.project_files.folders.subprocess.run") as run:
            import json
            run.return_value.stdout = json.dumps([str(self.first), str(self.second)])
            self.assertEqual(len(client.post(url + "/pick").json()), 2)
        self.assertEqual(len(client.post(url, json={"paths": [str(self.first)]}).json()), 2)
        docs = self.search()
        self.assertEqual({d["title"] for d in docs}, {"maps/nested/layout.md", "rules/notes.txt"})
        self.assertEqual(project_files.search(self.other, "lanterns"), [])
        self.plan.write_text("Revised fictional lanterns use amber ink.")
        self.assertIn("amber ink", str(self.search()))
        self.plan.unlink()
        self.assertNotIn("layout.md", str(self.search()))
        folder = next(row for row in client.get(url).json() if row["path"] == str(self.second.resolve()))
        client.delete(url.replace(self.project, self.other) + "/" + folder["id"])
        self.assertIn("notes.txt", str(self.search()))
        client.delete(url + "/" + folder["id"])
        self.assertEqual(self.search(), [])

    def test_symlinks_and_failed_or_cancelled_selection(self):
        (self.first / "outside").symlink_to(self.second, target_is_directory=True)
        (self.first / "alias.md").symlink_to(self.second / "notes.txt")
        client = TestClient(app)
        url = f"/lens/projects/{self.project}/folders"
        self.assertEqual(client.post(url, json={"paths": [str(self.first), "relative"]}).status_code, 400)
        self.assertEqual(client.get(url).json(), [])
        project_files.attach(self.project, [str(self.first)])
        self.assertEqual([d["title"] for d in self.search()], ["maps/nested/layout.md"])
        self.first.rename(self.first.with_name("old"))
        self.first.symlink_to(self.second, target_is_directory=True)
        self.assertEqual(self.search(), [])

    def test_read_later_page_and_invalidate_history_after_detaching(self):
        from langchain_core.messages import AIMessage
        from langgraph.checkpoint.memory import InMemorySaver

        from contextlens.graph import _builder
        from tests.support import reading, structured

        self.plan.write_text("Fictional staging area. " * 100 + "The beacon is amber.")
        [folder] = project_files.attach(self.project, [str(self.first)])
        file_id = self.search("staging")[0]["id"]
        tool_call = AIMessage(content="", tool_calls=[{"name": "read_file", "id": "page",
                              "args": {"file_path": "/projects/maps/nested/layout.md"}}])
        # The file is already in the prompt as f1; reading it again keeps that id.
        self.script(tool_call, "It is amber.[[f1]]", memory=[
            reading("reading a fictional plan"), structured("Lessons", lessons=[])])
        graph = _builder.compile(checkpointer=InMemorySaver())
        out = graph.invoke({"messages": [HumanMessage(content="staging")], "project_id": self.project},
                           {"configurable": {"thread_id": "fictional-files"}})
        version = out["turn_records"]["0"]["versions"][0]
        self.assertIn("The beacon is amber.", version["steps"][0]["result"])
        self.assertIn("[f1] /projects/maps/nested/layout.md", version["steps"][0]["result"])
        self.assertEqual(version["labels"]["f1"], file_id)
        self.assertEqual(version["segments"][0]["src"], [file_id])
        self.assertEqual(version["lineage"]["files"][0]["path"], "nested/layout.md")
        project_files.detach(self.project, folder["id"])
        preview = prepare_snapshot({**out, "messages": out["messages"] + [HumanMessage(content="Repeat it")]})
        self.assertNotIn("It is amber.", preview["messages"][0]["content"])

    def test_docx_and_binary_inventory(self):
        import zipfile

        with zipfile.ZipFile(self.first / "sample.docx", "w") as document:
            document.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/'
                              'wordprocessingml/2006/main"><w:p><w:r><w:t>虚构的青铜灯塔</w:t></w:r></w:p></w:document>')
        (self.first / "sample.png").write_bytes(b"\x00synthetic")
        project_files.attach(self.project, [str(self.first)])
        [doc] = self.search("灯塔")
        self.assertEqual(doc["content"], "虚构的青铜灯塔")
        files, _ = self.files()
        self.assertEqual(files.read("/maps/sample.docx").file_data["content"], "虚构的青铜灯塔")
        self.assertEqual([m["line"] for m in files.grep("青铜").matches], [1])
        self.assertIn("/maps/sample.png", [e["path"] for e in files.ls("/maps").entries])
        self.assertIsNotNone(files.read("/maps/sample.png").error)
        excluded, _ = self.files(excluded={doc["id"]})
        self.assertIsNotNone(excluded.read("/maps/sample.docx").error)
        self.assertEqual(excluded.grep("青铜").matches, [])

    def test_thumbnail_reads_document_start_and_is_project_scoped(self):
        from contextlens.project_files.thumbnails import thumbnail
        from contextlens.memory.types import MemoryError
        self.plan.write_text("# Fictional harbour\n\n" + "Page opening. " * 180 + "\nMatch: indigo")
        project_files.attach(self.project, [str(self.first)])
        source = next(c for c in self.search("indigo") if c["title"].endswith("layout.md"))
        data, mime = thumbnail(self.project, source["id"])
        self.assertEqual(mime, "image/svg+xml")
        self.assertIn(b"Fictional harbour", data)
        self.assertNotIn(b"Match: indigo", data)
        with self.assertRaises(MemoryError):
            thumbnail(self.other, source["id"])
        res = TestClient(app).get(f"/lens/projects/{self.project}/files/{source['id']}/thumbnail")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["cache-control"], "private, no-store")
        folder = project_files.folders(self.project)[0]
        project_files.detach(self.project, folder["id"])
        self.assertEqual(TestClient(app).get(f"/lens/projects/{self.project}/files/{source['id']}/thumbnail").status_code, 404)

    def test_thumbnail_cache_tracks_one_file_without_scanning_folders(self):
        from concurrent.futures import ThreadPoolExecutor
        from contextlens.project_files import thumbnails

        project_files.attach(self.project, [str(self.first)])
        source_id = self.search("indigo")[0]["id"]
        with patch("contextlens.project_files.index.files", side_effect=AssertionError("unexpected scan")), patch.object(
                thumbnails, "_render", wraps=thumbnails._render) as render:
            with ThreadPoolExecutor(4) as pool:
                results = list(pool.map(lambda _: thumbnails.thumbnail(self.project, source_id), range(4)))
            self.assertTrue(all(result == results[0] for result in results))
            self.assertEqual(render.call_count, 1)
            self.plan.write_text("Fictional revised chart.")
            self.assertIn(b"revised chart", thumbnails.thumbnail(self.project, source_id)[0])
            self.assertEqual(render.call_count, 2)
        project_files.search(self.project, "", inventory=True)
        with patch.object(thumbnails, "_render", side_effect=AssertionError("unexpected render")):
            self.assertIn(b"revised chart", thumbnails.thumbnail(self.project, source_id)[0])
            self.plan.unlink()
            with self.assertRaises(memory.MemoryError):
                thumbnails.thumbnail(self.project, source_id)
            self.plan.symlink_to(self.second / "notes.txt")
            with self.assertRaises(memory.MemoryError):
                thumbnails.thumbnail(self.project, source_id)

    def test_image_inventory_and_previews_upgrade_existing_folder(self):
        import base64
        import io
        from xml.etree import ElementTree
        from PIL import Image
        from contextlens.memory.store import session

        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5"/></svg>'
        (self.first / "circle.svg").write_bytes(svg)
        project_files.attach(self.project, [str(self.first)])
        for ext in ("png", "jpg", "gif", "webp"):
            Image.new("RGB", (640, 320), "purple").save(self.first / f"swatch.{ext}")

        def inventory():
            return {Path(item["title"]).name: item for item in project_files.search(self.project, "", inventory=True)}

        initial = inventory()
        with session() as conn:
            conn.execute("UPDATE project_documents SET image_indexed = 0")
            conn.execute("DELETE FROM project_passages WHERE document_id IN "
                         "(SELECT id FROM project_documents WHERE path LIKE 'swatch.%')")
        updated = inventory()
        client = TestClient(app)
        for name in ("circle.svg", "swatch.png", "swatch.jpg", "swatch.gif", "swatch.webp"):
            with self.subTest(name=name):
                source_id = updated[name]["id"]
                self.assertEqual(source_id, initial[name]["id"])
                response = client.get(f"/lens/projects/{self.project}/files/{source_id}/thumbnail")
                self.assertEqual(response.status_code, 200)
                if name.endswith(".svg"):
                    embedded = ElementTree.fromstring(response.content)[0].get("href")
                    self.assertEqual(base64.b64decode(embedded.split(",")[1]), svg)
                else:
                    with Image.open(io.BytesIO(response.content)) as preview:
                        self.assertEqual(preview.size, (480, 240))
                        self.assertEqual(preview.format, "PNG")

    def test_html_thumbnail_does_not_run_or_load_document_content(self):
        from contextlens.project_files.thumbnails import _text_page
        data, _ = _text_page("fiction.html", "<h1>Fictional greeting</h1><script>secretScript()</script><img src='https://example.invalid/a.png'>")
        self.assertIn(b"Fictional greeting", data)
        self.assertNotIn(b"secretScript", data)
        self.assertNotIn(b"https://", data)

    def test_create_with_folders_validates_before_persisting(self):
        client = TestClient(app)
        before = client.get("/lens/projects").json()
        response = client.post("/lens/projects", json={"name": "Fictional draft", "paths": [str(self.first), "relative"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(client.get("/lens/projects").json(), before)
        created = client.post("/lens/projects", json={"name": "Fictional draft", "paths": [str(self.first), str(self.second)]})
        self.assertEqual(created.status_code, 200)
        self.assertEqual(len(project_files.folders(created.json()["id"])), 2)

    def test_new_project_uses_its_settings_from_the_first_turn(self):
        client = TestClient(app)
        directive = "Use fictional chart labels."
        created = client.post("/lens/projects", json={"name": "Fictional charts", "paths": [str(self.first)],
                              "instructions": directive, "isolated": False})
        self.assertEqual(created.status_code, 200)
        project = created.json()
        self.assertFalse(project["isolated"])
        self.assertEqual(len(project_files.folders(project["id"])), 1)
        snapshot = prepare_snapshot({"project_id": project["id"], "messages": []})
        self.assertIn(directive, snapshot["messages"][0]["content"])

    def test_edit_notes_and_isolation_preserves_concurrent_changes(self):
        client = TestClient(app)
        url = f"/lens/projects/{self.project}"
        original = {"name": "Fictional lighthouse", "paths": [], "description": "", "isolated": True}
        draft = {**original, "description": "# Fictional exhibit", "isolated": False, "previous": original}
        self.assertEqual(client.put(url, json=draft).status_code, 200)
        self.assertEqual(client.put(url, json={**draft, "description": "Stale draft"}).status_code, 400)
        project = next(p for p in client.get("/lens/projects").json() if p["id"] == self.project)
        self.assertEqual((project["description"], project["isolated"]), ("# Fictional exhibit", False))

    def test_edit_then_remove_local_project_keeps_original_files(self):
        client = TestClient(app)
        url = f"/lens/projects/{self.project}"
        project_files.attach(self.project, [str(self.first)])
        draft = {"name": "Fictional atlas", "paths": [str(self.second)], "previous": {
            "name": "Fictional lighthouse", "paths": [str(self.first.resolve())]}}
        self.assertEqual(client.put(url, json=draft).status_code, 200)
        self.assertEqual(client.put(url, json=draft).status_code, 400)
        self.assertEqual([p["path"] for p in project_files.folders(self.project)], [str(self.second.resolve())])
        self.assertEqual(client.delete(url).status_code, 200)
        self.assertNotIn(self.project, [p["id"] for p in client.get("/lens/projects").json()])
        self.assertTrue((self.second / "notes.txt").is_file())
