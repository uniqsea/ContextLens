from contextlens import memory
from contextlens.memory import operations as ops
from tests.support import USER, StoreTestCase, reading, structured


class UpkeepTests(StoreTestCase):
    def test_only_what_was_shown_can_change_and_questions_go_to_the_user(self):
        project = ops.create_project("paper", USER)
        outside = self.add("outside")
        inside = self.add("published at CHI EA", scope=project.id)
        other = self.add("published at UIST", scope=project.id)
        self.script(memory=[structured("Plan", steps=[
            {"op": "correct", "memory_id": outside, "text": "changed", "reason": "x"},
            {"op": "ask", "text": "Two papers?", "memory_ids": [inside, other, outside], "reason": "unclear"}])])
        events = memory.upkeep.run(project.id)
        self.assertEqual(memory.get(memory.Memory, outside).learned, "outside")
        self.assertEqual(len(events), 1)
        self.assertEqual(ops.open_questions(project.id)[0].memory_ids, [inside, other])

    def test_an_isolated_project_cannot_distill_outward(self):
        project = ops.create_project("paper", USER)
        inside = self.add("a lesson", scope=project.id)
        step = {"op": "distill", "text": "general lesson", "memory_ids": [inside], "reason": "x"}
        self.script(memory=[structured("Plan", steps=[step]), structured("Plan", steps=[step])])
        memory.upkeep.run(project.id)
        self.assertEqual(memory.memories_in({memory.ORDINARY}), [])
        ops.set_isolated(project.id, False, USER)
        memory.upkeep.run(project.id)
        self.assertEqual([m.learned for m in memory.memories_in({memory.ORDINARY})], ["general lesson"])

    def test_due_facts_are_marked_and_recheck_moves_the_timer(self):
        mid = self.add("job hunting", check_at="2020-01-01")
        self.script(memory=[structured("Plan", steps=[
            {"op": "recheck", "memory_id": mid, "date": "2099-01-01", "reason": "still so"}])])
        memory.upkeep.run(memory.ORDINARY)
        self.assertIn("DUE", str(self.memory_model.calls[0][1].content))
        self.assertEqual(memory.get(memory.Memory, mid).check_at, "2099-01-01")


class ReadingTests(StoreTestCase):
    def test_a_known_concept_counts_only_if_the_conversation_names_it(self):
        self.add("a", concepts=["晴川"])
        self.add("b", concepts=["周老师"])
        self.script(memory=[reading("revising", concepts=["晴川", "周老师", "新朋友", "我"])])
        found = memory.identify([("user", "周老师会在意什么")], memory.ORDINARY)
        self.assertEqual(found["concepts"], ["周老师", "新朋友", "我"])

    def test_the_plain_reading_needs_no_model_and_finds_named_concepts(self):
        self.add("a", concepts=["周老师"])
        self.script(memory=[])
        self.assertEqual(memory.read_plainly("周老师会在意什么", memory.ORDINARY)["concepts"], ["周老师"])
        self.assertEqual(self.memory_model.calls, [])

    def test_no_scene_fit_for_several_turns_puts_a_proposal_to_the_user(self):
        earlier = [{"situation": {"new_scene": "job hunting"}}] * 2
        memory.propose_if_unfit(earlier, {"new_scene": "job hunting", "doing": "x"}, USER)
        self.assertEqual([(s.name, s.state) for s in memory.all_of(memory.Scene)], [("job hunting", "proposed")])
