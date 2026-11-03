from contextlens import memory
from contextlens.memory import operations as ops

from tests.support import USER, StoreTestCase


class LedgerTest(StoreTestCase):
    def test_every_change_is_an_event_and_can_be_undone(self):
        mid = self.add("喜欢短回答")
        event = ops.revise(mid, {"learned": "喜欢详细回答"}, USER)[0]
        self.assertEqual(event["before"]["learned"], "喜欢短回答")
        memory.revert(event["id"], USER)
        self.assertEqual(memory.get(memory.Memory, mid).learned, "喜欢短回答")
        with self.assertRaisesRegex(memory.MemoryError, "already been undone"):
            memory.revert(event["id"], USER)

    def test_a_change_that_changes_nothing_is_not_recorded(self):
        mid = self.add("喜欢短回答")
        self.assertEqual(ops.revise(mid, {"learned": "喜欢短回答"}, USER), [])

    def test_undoing_a_creation_removes_the_memory_and_keeps_the_history(self):
        mid = self.add("喜欢短回答")
        created = memory.list_events(entity_id=mid)[0]
        memory.revert(created["id"], USER)
        self.assertIsNone(memory.get(memory.Memory, mid))
        self.assertEqual(len(memory.list_events(entity_id=mid)), 2)

    def test_cannot_undo_under_a_later_change(self):
        mid = self.add("a")
        first = ops.revise(mid, {"learned": "b"}, USER)[0]
        ops.revise(mid, {"learned": "c"}, USER)
        with self.assertRaisesRegex(memory.MemoryError, "changed since"):
            memory.revert(first["id"], USER)

    def test_a_merge_is_undone_as_a_whole(self):
        a = self.add("一", concepts=["导师"])
        b = self.add("二", concepts=["Niklas"])
        keep, drop = ops.concepts_named(["导师"])[0], ops.concepts_named(["Niklas"])[0]
        events = ops.merge_concepts(keep.id, drop.id, USER)
        self.assertEqual(memory.get(memory.Memory, b).concepts, [keep.id])
        self.assertEqual(ops.concepts_named(["niklas"])[0].id, keep.id)
        memory.revert(events[0]["id"], USER)
        self.assertEqual(memory.get(memory.Memory, b).concepts, [drop.id])
        self.assertEqual(ops.concepts_named(["Niklas"])[0].id, drop.id)
        self.assertEqual(memory.get(memory.Memory, a).concepts, [keep.id])

    def test_purge_erases_content_from_history_and_cannot_be_undone(self):
        mid = self.add("秘密内容", situation="在说秘密")
        event = ops.revise(mid, {"learned": "更秘密的内容"}, USER)[0]
        memory.purge(mid, USER)
        self.assertNotIn("秘密", str(memory.list_events(entity_id=mid)))
        with self.assertRaises(memory.MemoryError):
            memory.revert(event["id"], USER)

    def test_a_correction_edits_but_a_change_in_the_world_keeps_a_timeline(self):
        old = self.add("是硕士生")
        new = ops.add_memory("硕士毕业，正在找工作", USER, replaces=old)[0]["entity_id"]
        self.assertEqual(memory.get(memory.Memory, old).state, "superseded")
        self.assertEqual([m.id for m in ops.timeline(old)], [old, new])
        self.assertEqual([m.id for m in ops.timeline(new)], [old, new])


class ScopeTest(StoreTestCase):
    def test_a_project_is_isolated_by_default(self):
        project = ops.create_project("论文", USER)
        self.add("外面的", scope=memory.ORDINARY, concepts=["导师"])
        self.add("里面的", scope=project.id, concepts=["编码表"])
        self.assertEqual(ops.visible_scopes(project.id), {project.id})
        self.assertEqual(ops.visible_scopes(memory.ORDINARY), {memory.ORDINARY})
        self.assertEqual([c["name"] for c in ops.concepts_in(memory.ORDINARY)], ["导师"])
        self.assertEqual([c["name"] for c in ops.concepts_in(project.id)], ["编码表"])

    def test_a_shared_project_also_reads_ordinary_but_not_the_other_way(self):
        project = ops.create_project("论文", USER)
        ops.set_isolated(project.id, False, USER)
        self.assertEqual(ops.visible_scopes(project.id), {project.id, memory.ORDINARY})
        self.assertEqual(ops.visible_scopes(memory.ORDINARY), {memory.ORDINARY})


class SceneTest(StoreTestCase):
    def test_a_proposal_takes_effect_only_after_agreement_and_is_asked_once(self):
        ops.propose_scene("求职", "几轮都归不进去", USER)
        self.assertEqual(ops.active_scenes(), [])
        scene = memory.all_of(memory.Scene)[0]
        ops.decide_scene(scene.id, False, USER)
        self.assertEqual(ops.propose_scene("求职", "again", USER), [])
        ops.decide_scene(scene.id, True, USER)
        self.assertEqual([s.name for s in ops.active_scenes()], ["求职"])
