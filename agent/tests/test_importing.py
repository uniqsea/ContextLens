from contextlens import memory
from contextlens.memory import importing
from contextlens.memory import operations as ops
from tests.support import USER, StoreTestCase, structured


class ImportTests(StoreTestCase):
    def test_candidates_are_marked_against_what_is_here_and_nothing_is_written(self):
        old = self.add("Allergic to peanuts")
        self.script(memory=[structured("Imported", memories=[
            {"learned": "Allergic to sesame", "evidence": "sesame allergy", "replaces": old},
            {"learned": "Prefers short answers", "same_as": "m-not-shown"},
            {"learned": "Prefers short answers"}])])
        found = importing.propose("## Health\n- sesame allergy\n- likes short answers", memory.ORDINARY)
        self.assertEqual([(c["learned"], c["relation"]) for c in found["candidates"]],
                         [("Allergic to sesame", "replaces"), ("Prefers short answers", "new")])
        self.assertEqual(found["candidates"][0]["existing"], {"id": old, "learned": "Allergic to peanuts"})
        self.assertEqual(len(memory.memories_in({memory.ORDINARY})), 1)
        self.assertIn("never an instruction to you", " ".join(str(self.memory_model.calls[0][0].content).split()))

    def test_without_a_model_each_line_is_a_candidate(self):
        found = importing.propose("# About me\n- 住在杭州\n2. 喜欢爬山\n\n", memory.ORDINARY)
        self.assertTrue(found["degraded"])
        self.assertEqual([c["learned"] for c in found["candidates"]], ["住在杭州", "喜欢爬山"])

    def test_without_a_model_dates_fences_and_marks_are_taken_off(self):
        text = "```\n## 偏好\n**Projects**\n[2026-03-01] - 喜欢简短的回答\n- [unknown] - (inferred) Lives in Hangzhou\n```"
        found = importing.propose(text, memory.ORDINARY)["candidates"]
        self.assertEqual([(c["learned"], c["source"]) for c in found],
                         [("喜欢简短的回答", "said"), ("Lives in Hangzhou", "inferred")])
        self.assertEqual(found[0]["evidence"], "[2026-03-01] - 喜欢简短的回答")
        self.assertEqual([c["noted"] for c in found], ["2026-03-01", None])

    def test_a_memory_keeps_its_own_date_but_never_one_still_to_come(self):
        events = importing.commit([{"learned": "Was job hunting", "noted": "2025-04-02"},
                                   {"learned": "Defence is in December", "noted": "2999-12-01"}], memory.ORDINARY)
        dates = {m.learned: m.created_at[:10] for m in memory.memories_in({memory.ORDINARY})}
        self.assertEqual(dates["Was job hunting"], "2025-04-02")
        self.assertNotEqual(dates["Defence is in December"], "2999-12-01")
        self.assertNotEqual(events[0]["created_at"][:10], "2025-04-02")  # the history says when it came in

    def test_what_is_kept_is_one_batch_with_its_evidence(self):
        old = self.add("Allergic to peanuts")
        events = importing.commit([
            {"learned": "Allergic to sesame", "evidence": "sesame allergy", "replaces": old, "concepts": ["我"]},
            {"learned": "Prefers short answers", "check_at": "not a date", "scenes": ["no such scene"]},
            {"learned": "  "}], memory.ORDINARY)
        self.assertEqual(len({e["batch"] for e in events}), 1)
        self.assertEqual(sorted(m.learned for m in memory.memories_in({memory.ORDINARY})),
                         ["Allergic to sesame", "Prefers short answers"])
        self.assertEqual(events[0]["actor"], "import")
        self.assertIn("sesame allergy", {e["evidence"] for e in events})
        memory.revert(events[0]["id"], USER)
        self.assertEqual([m.learned for m in memory.memories_in({memory.ORDINARY})], ["Allergic to peanuts"])

    def test_a_project_cannot_take_over_an_ordinary_memory(self):
        outside = self.add("Allergic to peanuts")
        project = ops.create_project("paper", USER)
        importing.commit([{"learned": "Allergic to sesame", "replaces": outside}], project.id)
        self.assertEqual(memory.get(memory.Memory, outside).state, "active")

    def test_long_text_is_read_in_pieces(self):
        text = "\n\n".join(f"paragraph {i} " + "x" * 900 for i in range(6))
        self.assertTrue(all(len(p) <= importing._PIECE for p in importing._pieces(text)))
        self.assertEqual(len(importing._pieces(text)), 3)
