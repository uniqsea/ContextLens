import unittest

from langchain_core.messages import AIMessage, HumanMessage

from contextlens import memory, records
from contextlens.context import memory_stamp, prepare_snapshot
from contextlens.memory import operations as ops
from tests.support import QUESTION, USER, StoreTestCase


class ContextTests(StoreTestCase):
    state = {"messages": [HumanMessage(content=QUESTION)]}

    def setUp(self):
        super().setUp()
        self.ids = self.add_examples()

    def request(self, **changes) -> str:
        return str(prepare_snapshot({**self.state, **changes})["messages"])

    def test_recall_selects_and_the_fingerprint_is_stable(self):
        snap = prepare_snapshot(self.state)
        self.assertEqual(snap["fingerprint"], prepare_snapshot(self.state)["fingerprint"])
        self.assertIn(self.ids["work"], snap["selected_ids"])
        self.assertNotIn(self.ids["personal"], snap["selected_ids"])
        self.assertNotIn("PERSONAL_SECRET", str(snap["messages"]))

    def test_explicit_selection_keeps_configured_scoring_and_can_be_empty(self):
        from unittest.mock import patch
        from contextlens.memory import llm

        with patch.object(llm, "embedder", return_value=None) as embedder:
            snap = prepare_snapshot({**self.state, "input_order": []})
        embedder.assert_called_once_with(local_only=False)
        self.assertEqual(snap["selected_ids"], ["sys-001", "usr-001"])
        self.assertEqual(snap["memory_dependencies"], {})
        self.assertNotIn("WORK_SECRET", str(snap["messages"]))
        self.assertTrue(any(c["relevance"] > 0 for c in snap["candidates"] if c["layer"] == "memory"))
        self.assertFalse(any(c["layer"] == "retrieval" for c in snap["candidates"]))

    def test_null_order_restores_automatic_selection_and_manual_override(self):
        automatic = prepare_snapshot({**self.state, "input_order": None})
        self.assertIn(self.ids["work"], automatic["selected_ids"])
        adjusted = prepare_snapshot({**self.state, "input_order": [self.ids["personal"]]})
        self.assertIn(self.ids["personal"], adjusted["selected_ids"])
        self.assertNotIn(self.ids["work"], adjusted["selected_ids"])

    def test_three_example_questions_automatically_include_fictional_memories(self):
        examples = [
            ("推荐一家周五团队聚餐的餐厅", "虚构团队周五聚餐选小南瓜餐厅", "安排团队聚餐"),
            ("事务隔离级别怎么理解？", "学习数据库事务隔离级别时希望用虚构书店订单举例", "学习事务隔离"),
            ("周四晚上约朋友吃饭去哪", "虚构朋友周四晚上在小风铃饭店吃饭", "周四约朋友吃饭"),
        ]
        for query, learned, doing in examples:
            with self.subTest(query=query):
                mid = self.add(learned, situation=doing)
                snap = prepare_snapshot({"messages": [HumanMessage(content=query)], "input_order": None})
                self.assertIn(mid, snap["selected_ids"])

    def test_a_scene_is_no_wall(self):
        # A memory from another scene still comes up when the moment reads as this one.
        reading = {"doing": QUESTION, "concepts": [], "scenes": ["生活"]}
        self.assertIn(self.ids["work"], prepare_snapshot({**self.state, "situation": reading})["selected_ids"])

    def test_dimming_a_concept_lowers_what_it_brings_up(self):
        lit = self.add("the concept fact", concepts=["晴川"])
        concept = ops.concepts_named(["晴川"])[0].id
        reading = {"doing": "", "concepts": ["晴川"], "scenes": []}
        turn = {**self.state, "messages": [HumanMessage(content="anything")], "situation": reading}
        self.assertIn(lit, prepare_snapshot(turn)["selected_ids"])
        self.assertNotIn(lit, prepare_snapshot({**turn, "dim": [concept]})["selected_ids"])

    def test_manual_add(self):
        state = {**self.state, "manual_memory_ids": [self.ids["personal"]]}
        self.assertIn(self.ids["personal"], prepare_snapshot(state)["selected_ids"])

    def test_request_ignore(self):
        self.assertNotIn("WORK_SECRET", self.request(context_policies=[{"item_id": self.ids["work"]}]))

    def test_forgotten_cannot_be_overridden(self):
        ops.forget(self.ids["work"], USER)
        self.assertNotIn("WORK_SECRET", self.request(manual_memory_ids=[self.ids["work"]]))

    def test_nothing_is_picked_before_a_question(self):
        snap = prepare_snapshot({**self.state, "messages": [HumanMessage(content="")]})
        self.assertFalse(set(snap["selected_ids"]) & set(self.ids.values()))

    def test_always_on_comes_along(self):
        fact = self.add("ALWAYS_FACT", always_on=True)
        self.assertIn(fact, prepare_snapshot(self.state)["selected_ids"])

    def test_reasons_are_codes(self):
        reasons = {c["id"]: c["selection_reason"] for c in prepare_snapshot(self.state)["candidates"]}
        self.assertEqual(reasons[self.ids["work"]], {"code": "relevant"})
        self.assertEqual(reasons[self.ids["personal"]], {"code": "not_ranked"})

    def test_what_was_going_on_reaches_the_model(self):
        ops.revise(self.ids["work"], {"situation": "planning the offsite"}, USER)
        self.assertIn("while planning the offsite", self.request())

    def test_a_turns_own_reading_is_used(self):
        reading = {"doing": "hiking with family", "concepts": [], "scenes": []}
        self.assertIn("PERSONAL_SECRET", self.request(situation=reading, messages=[HumanMessage(content="weekend")]))

    def test_an_isolated_project_sees_only_itself(self):
        project = ops.create_project("paper", USER)
        inside = self.add("the team dinner budget for the paper", scope=project.id)
        snap = prepare_snapshot({**self.state, "project_id": project.id})
        self.assertEqual([i for i in snap["selected_ids"] if i.startswith("m-")], [inside])
        self.assertNotIn(inside, prepare_snapshot(self.state)["selected_ids"])


class HistoryTests(StoreTestCase):
    def setUp(self):
        super().setUp()
        self.ids = self.add_examples()

    def history(self, turns=1):
        work = next(r for r in records.records() if r["id"] == self.ids["work"])
        messages, lineage = [], {}
        for i in range(turns):
            messages += [HumanMessage(content=f"old question {i}"), AIMessage(content=f"WORK_SECRET answer {i}")]
            lineage[str(i)] = {"memories": {work["id"]: memory_stamp(work)}, "history": list(range(i))}
        messages.append(HumanMessage(content=QUESTION))
        return {"messages": messages, "history_lineage": lineage}

    def test_history_without_lineage_is_not_forwarded(self):
        state = {**self.history(), "history_lineage": {}}
        self.assertNotIn("old question", str(prepare_snapshot(state)["messages"]))

    def test_memory_revision_invalidates_dependent_history(self):
        state = self.history()
        ops.revise(self.ids["work"], {"learned": "NEW_FACT: the team dinner budget is 200"}, USER)
        text = str(prepare_snapshot(state)["messages"])
        self.assertNotIn("WORK_SECRET", text)
        self.assertIn("NEW_FACT", text)

    def test_ignored_turn_invalidates_later_turns(self):
        state = {**self.history(3), "context_policies": [{"item_id": "st-0000"}]}
        self.assertNotIn("old question", str(prepare_snapshot(state)["messages"]))

    def test_summary_is_rebuilt_from_permitted_sources(self):
        state = self.history(22)
        self.assertEqual(len(prepare_snapshot(state)["summary_dependencies"]), 16)
        snap = prepare_snapshot({**state, "context_policies": [{"item_id": self.ids["work"]}]})
        self.assertEqual(snap["summary_dependencies"], [])
        self.assertNotIn("old question", str(snap["messages"]))


if __name__ == "__main__":
    unittest.main()
