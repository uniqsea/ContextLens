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
        tool_call = AIMessage(content="", tool_calls=[{"name": "browse_project_files", "id": "page",
                              "args": {"file_id": file_id, "offset": 1}}])
        self.script(tool_call, f"It is amber.[[{file_id}]]", memory=[
            reading("reading a fictional plan"), structured("Lessons", lessons=[])])
        graph = _builder.compile(checkpointer=InMemorySaver())
        out = graph.invoke({"messages": [HumanMessage(content="staging")], "project_id": self.project},
                           {"configurable": {"thread_id": "fictional-files"}})
        version = out["turn_records"]["0"]["versions"][0]
        self.assertIn("The beacon is amber.", version["steps"][0]["result"])
        self.assertEqual(version["segments"][0]["src"], [file_id])
        project_files.detach(self.project, folder["id"])
        preview = prepare_snapshot({**out, "messages": out["messages"] + [HumanMessage(content="Repeat it")]})
        self.assertNotIn("It is amber.", preview["messages"][0]["content"])

    def test_docx_and_binary_inventory(self):
        import zipfile

        from contextlens.project_files.index import browse

        with zipfile.ZipFile(self.first / "sample.docx", "w") as document:
            document.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/'
                              'wordprocessingml/2006/main"><w:p><w:r><w:t>虚构的青铜灯塔</w:t></w:r></w:p></w:document>')
        (self.first / "sample.png").write_bytes(b"\x00synthetic")
        project_files.attach(self.project, [str(self.first)])
        [doc] = self.search("灯塔")
        self.assertEqual(doc["content"], "虚构的青铜灯塔")
        self.assertEqual(browse(self.project, "", doc["id"], 0, {doc["id"]})[1], {})
        listing, _ = browse(self.project, ".png", "", 0, set())
        self.assertIn("sample.png", listing)

    def test_create_with_folders_validates_before_persisting(self):
        client = TestClient(app)
        before = client.get("/lens/projects").json()
        response = client.post("/lens/projects", json={"name": "Fictional draft", "paths": [str(self.first), "relative"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(client.get("/lens/projects").json(), before)
        created = client.post("/lens/projects", json={"name": "Fictional draft", "paths": [str(self.first), str(self.second)]})
        self.assertEqual(created.status_code, 200)
        self.assertEqual(len(project_files.folders(created.json()["id"])), 2)

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
