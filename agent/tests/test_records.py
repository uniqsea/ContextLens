import json
import os
from pathlib import Path

from starlette.testclient import TestClient

from contextlens import memory, records
from contextlens.api import app
from contextlens.memory import operations as ops
from tests.support import USER, StoreTestCase, structured


class RecordsTests(StoreTestCase):
    def test_a_memory_in_the_shape_the_ui_reads(self):
        ops.add_memory("prefers short replies", USER, situation="asking quick questions", scenes=["工作"], origin="inferred", concepts=["我"])
        record = records.records()[0]
        self.assertEqual((record["title"], record["content"], record["scenes"]),
                         ("asking quick questions", "prefers short replies", ["工作"]))
        self.assertEqual([c["name"] for c in record["concepts"]], ["我"])
        self.assertEqual((record["revision"], record["confidence"], record["lifecycle_state"]), (1, "low", "active"))

    def test_kinds_are_read_off_each_change(self):
        mid = self.add("a")
        ops.revise(mid, {"learned": "b"}, USER)
        ops.forget(mid, USER)
        ops.restore(mid, USER)
        memory.purge(mid, USER)
        self.assertEqual([e["kind"] for e in records.events(mid)],
                         ["purged", "restored", "trashed", "revised", "created"])

    def test_a_replaced_fact_is_not_listed_but_its_change_is(self):
        old = self.add("studying")
        events = ops.add_memory("working", USER, replaces=old)
        self.assertEqual([r["content"] for r in records.records(include_trashed=True)], ["working"])
        self.assertEqual({e["kind"] for e in records.changes(events)}, {"created", "trashed"})

    def test_undo_links_both_ways(self):
        mid = self.add("a")
        change = ops.revise(mid, {"learned": "b"}, USER)[0]
        undo = memory.revert(change["id"], USER)[0]
        self.assertEqual(records.changes([undo])[0]["reverts"], change["id"])
        by_id = {e["id"]: e for e in records.events(mid)}
        self.assertEqual(by_id[change["id"]]["reverted_by"], undo["id"])
        self.assertEqual(by_id[undo["id"]]["reverts"], change["id"])

    def test_concepts_and_other_entities_stay_out_of_the_memory_history(self):
        ops.add_memory("a", USER, concepts=["周老师"])
        self.assertEqual([e["kind"] for e in records.events()], ["created"])

    def test_a_new_store_starts_from_the_seed_file(self):
        Path(os.environ["CONTEXTLENS_SEED_PATH"]).write_text(json.dumps(
            [{"title": "团队", "content": "团队在上海", "context_scope": "work"}]))
        self.assertEqual([r["content"] for r in records.records()], ["团队在上海"])
        self.assertEqual(len(records.records()), 1)

    def test_a_new_store_without_local_seeds_starts_empty(self):
        Path(os.environ["CONTEXTLENS_SEED_PATH"]).unlink()
        self.assertEqual(records.records(), [])
        self.assertEqual(memory.list_events(limit=1), [])


class LibraryRouteTests(StoreTestCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)

    def create(self):
        return self.client.post("/lens/memories", json={"title": "安排聚餐", "content": "不吃辣", "scenes": ["工作"], "concepts": ["我"]}).json()

    def test_library_filters_by_owner_independently_of_chat_visibility(self):
        shared = ops.create_project("Fictional observatory", USER, isolated=False).id
        isolated = ops.create_project("Fictional workshop", USER).id
        for owner in (memory.ORDINARY, shared, isolated):
            self.add("Synthetic scope check", scope=owner)

        def scopes(**params):
            rows = self.client.get("/lens/memories", params=params).json()["memories"]
            return sorted(row["scope"] for row in rows)

        self.assertEqual(scopes(view="library"), sorted([memory.ORDINARY, shared, isolated]))
        self.assertEqual(scopes(view="library", scope=shared), [shared])
        self.assertEqual(scopes(view="library", scope=memory.ORDINARY), [memory.ORDINARY])
        self.assertEqual(scopes(scope=shared), sorted([memory.ORDINARY, shared]))
        self.assertEqual(scopes(scope=isolated), [isolated])

    def test_refuses_browsers(self):
        self.assertEqual(self.client.get("/lens/memories", headers={"origin": "https://x"}).status_code, 403)

    def test_create_edit_trash_restore_undo(self):
        made = self.create()
        mid = made["memory"]["id"]
        self.assertEqual(made["event"]["kind"], "created")
        edited = self.client.patch(f"/lens/memories/{mid}", json={"content": "不吃辣也不吃香菜", "revision": 1}).json()
        self.assertEqual(edited["memory"]["revision"], 2)
        self.assertEqual(self.client.patch(f"/lens/memories/{mid}", json={"content": "x", "revision": 1}).status_code, 409)
        self.client.post(f"/lens/memories/{mid}/trash")
        self.assertEqual(self.client.get("/lens/memories").json()["memories"], [])
        self.assertEqual(len(self.client.get("/lens/memories?include_trashed=1").json()["memories"]), 1)
        self.client.post(f"/lens/memories/{mid}/restore")
        self.client.patch(f"/lens/memories/{mid}", json={"content": "只不吃香菜"})
        undo = self.client.post(f"/lens/memory-events/{edited['event']['id']}/revert")
        self.assertEqual(undo.status_code, 400)  # a later change stands in the way
        events = self.client.get(f"/lens/memories/{mid}/events").json()["events"]
        self.assertEqual(self.client.post(f"/lens/memory-events/{events[0]['id']}/revert").status_code, 200)
        self.assertEqual(self.client.get("/lens/memories").json()["memories"][0]["content"], "不吃辣也不吃香菜")

    def test_there_is_no_blocking(self):
        mid = self.create()["memory"]["id"]
        self.assertEqual(self.client.post(f"/lens/memories/{mid}/block", json={"mode": "work"}).status_code, 404)

    def test_the_situation_list_is_the_users_and_proposals_need_agreement(self):
        self.client.post("/lens/scenes", json={"scenes": [{"name": "工作"}, {"name": "生活"}]})
        ops.propose_scene("求职", "several turns fit none", USER)
        overview = self.client.get("/lens/overview").json()
        self.assertEqual([s["name"] for s in overview["scenes"]], ["工作", "生活"])
        proposed = overview["proposed_scenes"][0]
        self.client.post(f"/lens/scenes/{proposed['id']}/accept")
        self.assertIn("求职", [s["name"] for s in self.client.get("/lens/overview").json()["scenes"]])
        self.client.post("/lens/scenes", json={"scenes": [{"name": "工作"}, {"name": "学习"}]})
        self.assertEqual({s["name"] for s in self.client.get("/lens/overview").json()["scenes"]}, {"工作", "学习"})
        self.assertEqual(ops.propose_scene("生活", "again", USER), [])

    def test_ai_suggests_and_nothing_is_saved_until_the_user_agrees(self):
        self.script(memory=[structured("SuggestedSituations", situations=[
            {"name": "写论文", "definition": "为了完成学业", "reason": "你说主要用来改论文"},
            {"name": " ", "definition": "", "reason": "空的"}])])
        before = [s["name"] for s in self.client.get("/lens/overview").json()["scenes"]]
        found = self.client.post("/lens/scenes/suggest", json={
            "description": "主要用来改论文", "current": [{"name": "工作", "definition": "为了对外交付"}]})
        self.assertEqual(found.json()["situations"], [
            {"name": "写论文", "definition": "为了完成学业", "reason": "你说主要用来改论文"}])
        self.assertIn("为了对外交付", str(self.memory_model.calls[0][1].content))
        self.assertEqual([s["name"] for s in self.client.get("/lens/overview").json()["scenes"]], before)

    def test_a_new_store_starts_from_the_presets_and_removing_them_stays_removed(self):
        scenes = self.client.get("/lens/overview").json()["scenes"]
        self.assertEqual([s["name"] for s in scenes], ["工作", "学习", "生活"])
        self.assertTrue(all(s["definition"] for s in scenes))
        self.client.post("/lens/scenes", json={"scenes": []})
        self.assertEqual(self.client.get("/lens/overview").json()["scenes"], [])

    def test_renaming_a_scene_moves_its_label_and_removing_one_keeps_it(self):
        self.client.post("/lens/scenes", json={"scenes": [{"name": "工作"}, {"name": "生活"}]})
        ops.add_memory("prefers short replies", USER, scenes=["工作"])
        ops.add_memory("likes hiking", USER, scenes=["生活"])
        work = next(s for s in self.client.get("/lens/overview").json()["scenes"] if s["name"] == "工作")
        saved = self.client.post("/lens/scenes", json={"scenes": [{"id": work["id"], "name": "职业", "definition": "为了收入"}]})
        self.assertEqual(saved.status_code, 200)
        scenes = self.client.get("/lens/overview").json()["scenes"]
        self.assertEqual([(s["id"], s["name"], s["definition"]) for s in scenes], [(work["id"], "职业", "为了收入")])
        self.assertEqual({tuple(r["scenes"]) for r in self.client.get("/lens/memories").json()["memories"]},
                         {("职业",), ("生活",)})

    def test_two_scenes_cannot_share_a_name(self):
        taken = self.client.post("/lens/scenes", json={"scenes": [{"name": "工作"}, {"name": " 工作 "}]})
        self.assertEqual(taken.status_code, 400)

    def test_a_failed_suggestion_says_so(self):
        self.script(memory=[])
        self.assertEqual(self.client.post("/lens/scenes/suggest", json={"description": "x"}).status_code, 502)
        self.assertEqual(self.client.post("/lens/scenes/suggest", json={"description": " "}).status_code, 400)

    def test_a_project_is_isolated_and_keeps_its_memories(self):
        project = self.client.post("/lens/projects", json={"name": "论文"}).json()
        self.assertTrue(project["isolated"])
        inside = self.client.post(f"/lens/memories?scope={project['id']}", json={"title": "编码", "content": "以文件为准"}).json()
        self.assertEqual(inside["memory"]["content"], "以文件为准")
        self.assertEqual(self.client.get("/lens/memories").json()["memories"], [])
        listed = self.client.get(f"/lens/memories?scope={project['id']}").json()["memories"]
        self.assertEqual([m["content"] for m in listed], ["以文件为准"])
        self.client.patch(f"/lens/projects/{project['id']}", json={"isolated": False})
        self.assertFalse(self.client.get("/lens/overview").json()["projects"][0]["isolated"])

    def test_concepts_can_be_managed(self):
        a = self.client.post("/lens/memories", json={"title": "t", "content": "一", "concepts": ["导师"]}).json()["memory"]
        b = self.client.post("/lens/memories", json={"title": "t", "content": "二", "concepts": ["周老师"]}).json()["memory"]
        keep, drop = a["concepts"][0]["id"], b["concepts"][0]["id"]
        self.client.post("/lens/concepts/merge", json={"keep": keep, "drop": drop})
        concepts = self.client.get("/lens/overview").json()["concepts"]
        self.assertEqual([(c["name"], c["aliases"], c["count"]) for c in concepts], [("导师", ["周老师"], 2)])
        self.client.post(f"/lens/concepts/{keep}/split", json={"name": "周老师", "memory_ids": [b["id"]]})
        self.assertEqual(len(self.client.get("/lens/overview").json()["concepts"]), 2)
        self.client.patch(f"/lens/concepts/{keep}", json={"name": "我的导师"})
        self.assertIn("我的导师", [c["name"] for c in self.client.get("/lens/overview").json()["concepts"]])

    def test_questions_and_the_facts_timeline(self):
        ops.ask("是两篇吗？", memory.ORDINARY, [], USER)
        question = self.client.get("/lens/overview").json()["questions"][0]
        self.client.post(f"/lens/questions/{question['id']}", json={"answer": "是两篇"})
        self.assertEqual(self.client.get("/lens/overview").json()["questions"], [])
        old = self.add("在读书")
        new = ops.add_memory("在工作", USER, replaces=old)[0]["entity_id"]
        chain = self.client.get(f"/lens/memories/{new}/timeline").json()["timeline"]
        self.assertEqual([(c["content"], c["current"]) for c in chain], [("在读书", False), ("在工作", True)])

    def test_always_on_can_be_set(self):
        mid = self.create()["memory"]["id"]
        made = self.client.patch(f"/lens/memories/{mid}", json={"always_on": True}).json()
        self.assertTrue(made["memory"]["always_on"])
