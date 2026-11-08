import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from starlette.testclient import TestClient

from contextlens import memory
from contextlens.api import app
from contextlens.graph import _builder
from contextlens.memory import operations as ops
from contextlens.provenance import parse_segments
from tests.support import QUESTION, USER, StoreTestCase, reading, structured

NOTHING = structured("Lessons", lessons=[])


class GraphTests(StoreTestCase):
    state = {"messages": [HumanMessage(content=QUESTION)]}

    def setUp(self):
        super().setUp()
        self.ids = self.add_examples()
        self.work = self.ids["work"]

    def run_graph(self):
        graph = _builder.compile(checkpointer=InMemorySaver())
        return lambda value: graph.invoke(value, {"configurable": {"thread_id": "t"}})

    def memory_replies(self, turns=1):
        return [r for _ in range(turns) for r in (reading("planning the dinner"), NOTHING)]

    def test_answer_records_sources_and_the_exact_request(self):
        model = self.script(f"Use the work fact.[[{self.work}]] Bogus.[[nope]] Done.", memory=self.memory_replies())
        out = self.run_graph()(self.state)
        self.assertEqual(out["messages"][-1].content, "Use the work fact. Bogus. Done.")
        version = out["turn_records"]["0"]["versions"][-1]
        self.assertEqual([s["src"] for s in version["segments"]], [[self.work], [], []])
        # The engine leads with the snapshot's prompt and asks the snapshot's question, nothing else.
        sent = model.calls[0]
        self.assertIsInstance(sent[0], SystemMessage)
        self.assertTrue(sent[0].content.startswith(version["payload"][0]["content"]))
        self.assertEqual([m.content for m in sent[1:]], [version["payload"][1]["content"]])
        # Unlike the prepared payload, the observed call includes the harness instructions.
        self.assertEqual([m["content"] for m in version["agent_calls"][0]["messages"]], [m.content for m in sent])
        for stage, call in zip(("reading_calls", "writing_calls"), self.memory_model.calls, strict=True):
            self.assertEqual([m["content"] for m in version[stage][0]["messages"]], [m.content for m in call])

    def test_saved_project_instructions_reach_only_its_chat_and_preview(self):
        from contextlens import projects
        from contextlens.context import prepare_snapshot

        project = ops.create_project("Fictional observatory", USER)
        other = ops.create_project("Fictional theater", USER)
        projects.configure(project.id, {"description": "Unpublished fictional note"})
        fields = {"name": project.name, "paths": [], "isolated": project.isolated, "instructions": ""}
        directive = "Use fictional constellation names in examples."
        client = TestClient(app)
        url = f"/lens/projects/{project.id}"
        saved = {**fields, "instructions": directive}
        self.assertEqual(client.put(url, json={**saved, "previous": fields}).status_code, 200)
        state = {**self.state, "project_id": project.id, "input_order": []}
        preview = prepare_snapshot(state)
        self.assertIn("sys-project", preview["selected_ids"])
        self.assertNotIn("Unpublished fictional note", str(preview))
        model = self.script("ok.", memory=self.memory_replies())
        self.run_graph()(state)
        self.assertIn(directive, model.calls[0][0].content)
        for scope in (other.id, None):
            self.assertNotIn(directive, str(prepare_snapshot({**state, "project_id": scope})))
        self.assertEqual(client.put(url, json={**fields, "previous": saved}).status_code, 200)
        self.assertNotIn("sys-project", prepare_snapshot(state)["selected_ids"])

    def test_the_turn_is_read_before_memory_is_used_and_kept_with_what_it_wrote(self):
        self.script("ok.", memory=[reading("planning the offsite dinner"), structured(
            "Lessons", lessons=[{"learned": "budget doubled this year", "concepts": ["team"], "scenes": ["工作"]}])])
        memory.operations.save_scenes([{"name": "工作"}], USER)
        self.memory_model.replies[0] = reading("planning the offsite dinner", scenes=["工作"])
        record = self.run_graph()(self.state)["turn_records"]["0"]
        self.assertEqual(record["versions"][-1]["situation"]["doing"], "planning the offsite dinner")
        change = record["memory_changes"][0]
        self.assertEqual((change["kind"], change["actor"], change["content"]),
                         ("created", "consolidation", "budget doubled this year"))
        kept = memory.get(memory.Memory, change["memory_id"])
        self.assertEqual((kept.situation, kept.scenes), ("planning the offsite dinner", ["工作"]))

    def test_an_answer_survives_a_failing_memory_model(self):
        self.script("ok.", memory=[])
        out = self.run_graph()(self.state)
        self.assertEqual(out["messages"][-1].content, "ok.")
        self.assertTrue(out["turn_records"]["0"]["versions"][-1]["situation"]["degraded"])

    def test_the_agents_tools_are_listed_as_changes_of_the_turn(self):
        call = AIMessage(content="", tool_calls=[{"name": "remember", "id": "1", "args": {
            "learned": "does not eat spicy food", "reason": "asked to", "concepts": ["我"]}}])
        self.script(call, "noted.", memory=self.memory_replies())
        changes = self.run_graph()(self.state)["turn_records"]["0"]["memory_changes"]
        self.assertEqual([(c["actor"], c["content"]) for c in changes], [("agent", "does not eat spicy food")])

    def test_memories_the_agent_looks_up_can_be_cited(self):
        call = AIMessage(content="", tool_calls=[{"name": "recall", "id": "1", "args": {"query": "weekend hiking"}}])
        personal = self.ids["personal"]
        self.script(call, f"You hike.[[{personal}]]", memory=self.memory_replies())
        version = self.run_graph()(self.state)["turn_records"]["0"]["versions"][-1]
        self.assertEqual(version["segments"][0]["src"], [personal])
        first, second = version["agent_calls"]
        step, = version["steps"]
        self.assertEqual(first["output"]["tool_calls"][0]["id"], step["call_id"])
        self.assertEqual(second["messages"][-1], {"role": "tool", "content": step["result"], "tool_call_id": step["call_id"]})

    def test_explicit_empty_selection_scopes_prompt_and_writer_but_not_tools(self):
        # A hand-picked selection is what the turn must use, not all it may look at: the agent's own
        # lookups still see the rest of the scope.
        hidden_name = "Fictional orchard parcel"
        hidden = self.add("The synthetic parcel number is 36.", concepts=[hidden_name])
        reread = AIMessage(content="", tool_calls=[{"name": "identify_situation", "id": "again",
                                                    "args": {"what_changed": "Check the revised question"}}])
        writer = structured("Lessons", lessons=[{"learned": "A synthetic update", "corrects": hidden, "replaces": hidden}])
        agent = self.script(reread, "Done.", memory=[reading("Reading"), reading("Reading again"), writer])
        # Background cross-turn maintenance is separate from the requests under test.
        with patch.object(memory.upkeep, "run_if_due"):
            version = self.run_graph()({**self.state, "input_order": []})["turn_records"]["0"]["versions"][0]
        self.assertEqual(len(agent.calls), 2)
        self.assertEqual(len(self.memory_model.calls), 3)
        before, nested, writer_call = self.memory_model.calls
        for messages in (agent.calls[0], before, writer_call):
            for forbidden in (hidden_name, hidden, "parcel number is 36", "WORK_SECRET", "PERSONAL_SECRET", "GENERAL_FACT"):
                self.assertNotIn(forbidden, str(messages))
        self.assertIn(hidden_name, str(nested))
        self.assertEqual(len(version["agent_calls"]), 2)
        self.assertEqual(len(version["steps"][0]["artifact"]["reading_calls"]), 1)
        self.assertEqual(memory.get(memory.Memory, hidden).learned, "The synthetic parcel number is 36.")
        self.assertIsNone(memory.get(memory.Memory, hidden).superseded_by)

    def test_explicit_selection_scopes_writer_and_reading_to_chosen_memory(self):
        model = self.script("Done.", memory=self.memory_replies())
        self.run_graph()({**self.state, "input_order": [self.work]})
        self.assertIn("WORK_SECRET", str(model.calls[0]))
        self.assertIn(self.work, str(self.memory_model.calls[-1]))
        for messages in (model.calls[0], self.memory_model.calls[-1]):
            self.assertNotIn("PERSONAL_SECRET", str(messages))
            self.assertNotIn("GENERAL_FACT", str(messages))

    def test_tools_cannot_reach_across_a_boundary(self):
        project = ops.create_project("paper", USER)
        call = AIMessage(content="", tool_calls=[{"name": "forget", "id": "1", "args": {
            "memory_id": self.work, "reason": "x"}}])
        self.script(call, "ok.", memory=self.memory_replies())
        self.run_graph()({**self.state, "project_id": project.id})
        self.assertEqual(memory.get(memory.Memory, self.work).state, "active")

    def test_memory_tools_take_the_short_id_shown(self):
        call = AIMessage(content="", tool_calls=[{"name": "forget", "id": "1", "args": {"memory_id": "m1", "reason": "x"}}])
        self.script(call, "ok.", memory=self.memory_replies())
        self.run_graph()({**self.state, "input_order": [self.work]})
        self.assertEqual(memory.get(memory.Memory, self.work).state, "forgotten")

    def test_request_choices_apply_once(self):
        model = self.script("first.", "second.", memory=self.memory_replies(2))
        run = self.run_graph()
        out = run({**self.state, "context_policies": [{"item_id": self.work}]})
        self.assertNotIn("WORK_SECRET", str(model.calls[0]))
        self.assertEqual(out["context_policies"], [])
        out = run({"messages": [HumanMessage(content=QUESTION + " again")]})
        self.assertIn(self.work, out["turn_records"]["1"]["versions"][-1]["selected_ids"])

    def test_rewrite_one_answer_and_undo_it(self):
        model = self.script(f"first.[[{self.work}]]", "second.", memory=self.memory_replies())
        run = self.run_graph()
        ai_id = run(self.state)["messages"][-1].id
        note = [{"op": "exclude", "id": self.work}]
        out = run({"regen_request": {"turn": 0, "excluded": [self.work], "note": note}})
        self.assertNotIn("WORK_SECRET", str(model.calls[1]))
        self.assertEqual([m.id for m in out["messages"]][-1], ai_id)
        self.assertEqual(out["messages"][-1].content, "second.")
        self.assertEqual([v["note"] for v in out["turn_records"]["0"]["versions"]], [[], note])
        rewritten = out["turn_records"]["0"]["versions"][-1]
        self.assertNotIn("reading_calls", rewritten)
        self.assertNotIn("writing_calls", rewritten)
        self.assertEqual(rewritten["agent_calls"][0]["output"]["content"], "second.")
        out = run({"regen_request": {"turn": 0, "action": "undo"}})
        self.assertEqual(out["messages"][-1].content, "first.")
        self.assertEqual(len(out["turn_records"]["0"]["versions"]), 1)

    def test_only_the_users_words_reach_the_writer(self):
        self.script("ANSWER_TEXT from a document.", memory=[reading("x"), NOTHING])
        self.run_graph()(self.state)
        self.assertNotIn("ANSWER_TEXT", str(self.memory_model.calls[1]))
        self.assertIn(QUESTION, str(self.memory_model.calls[1]))

    def test_correcting_the_reading_rewrites_the_answer_and_moves_what_the_turn_wrote(self):
        ops.save_scenes([{"name": "学习"}], USER)
        self.script("first.", "second.", memory=[reading("chatting"), structured(
            "Lessons", lessons=[{"learned": "The fictional seminar uses paper models", "scenes": ["学习","unconfigured"]}])])
        run = self.run_graph()
        written = run(self.state)["turn_records"]["0"]["memory_changes"][0]["memory_id"]
        fixed = {"doing": "planning the offsite", "scenes": ["工作"]}
        out = run({"regen_request": {"turn": 0, "situation": fixed}})
        self.assertEqual(out["messages"][-1].content, "second.")
        self.assertEqual(out["turn_records"]["0"]["versions"][-1]["situation"]["doing"], "planning the offsite")
        kept = memory.get(memory.Memory, written)
        self.assertEqual((kept.situation, kept.scenes), ("planning the offsite", ["学习"]))

    def test_rewriting_with_a_dimmed_concept_keeps_it_out(self):
        lit = self.add("CONCEPT_FACT", concepts=["晴川"])
        concept = ops.concepts_named(["晴川"])[0].id
        model = self.script("first.", "second.", memory=[reading("x", concepts=["晴川"]), NOTHING])
        run = self.run_graph()
        first = run({"messages": [HumanMessage(content="晴川 怎么样")]})
        self.assertIn(lit, first["turn_records"]["0"]["versions"][-1]["selected_ids"])
        self.assertEqual(first["turn_records"]["0"]["versions"][-1]["concepts"], [{"id": concept, "name": "晴川"}])
        out = run({"regen_request": {"turn": 0, "dim": [concept]}})
        self.assertNotIn("CONCEPT_FACT", str(model.calls[1]))
        self.assertEqual(out["turn_records"]["0"]["versions"][-1]["dim"], [concept])

    def test_the_reading_sees_definitions_and_keeps_at_most_two_scenes_main_first(self):
        memory.operations.save_scenes([{"name": n, "definition": f"{n}的定义"} for n in ("工作", "学习", "生活")], USER)
        self.script(memory=[reading("revising", scenes=["学习", "工作", "学习", "生活"])])
        found = memory.identify([("user", "hi")], memory.ORDINARY)
        self.assertEqual(found["scenes"], ["学习", "工作"])
        self.assertIn("学习的定义", str(self.memory_model.calls[0][1].content))

    def test_several_turns_fitting_no_scene_put_a_proposal_to_the_user(self):
        replies = [r for _ in range(3) for r in (reading("job hunting", new_scene="求职"), NOTHING)]
        self.script("a.", "b.", "c.", memory=replies)
        run = self.run_graph()
        for text in ("one", "two", "three"):
            run({"messages": [HumanMessage(content=text)]})
        self.assertEqual([(s.name, s.state) for s in memory.all_of(memory.Scene)], [("求职", "proposed")])

    def test_preview_route_never_calls_a_model(self):
        model = self.script()
        res = TestClient(app).post("/lens/preview", json={"messages": [{"type": "human", "content": QUESTION}]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(model.calls, [])
        self.assertEqual(self.memory_model.calls, [])
        self.assertIn(self.work, res.json()["selected_ids"])


class ProvenanceTests(unittest.TestCase):
    def test_short_ids_map_back_to_store_ids(self):
        from contextlens.provenance import Labels

        labels = Labels()
        self.assertEqual([labels.short("mem-x", "memory"), labels.short("doc-y", "retrieval"),
                          labels.short("mem-z", "memory"), labels.short("mem-x", "memory")], ["m1", "f1", "m2", "m1"])
        again = Labels(labels.table)
        self.assertEqual(again.short("st-0001", "short_term"), "t1")
        self.assertEqual(again.short("mem-w", "memory"), "m3")
        text, segments = parse_segments("用了它。[[m2]] 也用了。[[ f1 , mem-x]] 编的。[[m9]]", ["mem-x", "mem-z", "doc-y"], again)
        self.assertEqual([s["src"] for s in segments], [["mem-z"], ["doc-y", "mem-x"], []])

    def test_sentences_keep_their_sources(self):
        text, segments = parse_segments("先说结论：订素菜。[[a]][[b]]人均150元。没有依据。", ["a", "b"])
        self.assertEqual(text, "先说结论：订素菜。人均150元。没有依据。")
        self.assertEqual([s["src"] for s in segments], [["a", "b"], [], []])

    def test_spaced_markers_are_still_markers(self):
        text, segments = parse_segments("选清淡的。[ [a]]\n\n控制预算。[[b] ]", ["a", "b"])
        self.assertEqual(text, "选清淡的。\n\n控制预算。")
        self.assertEqual([s["src"] for s in segments], [["a"], ["b"]])

    def test_line_breaks_stay_with_the_sentence_before(self):
        text, segments = parse_segments("结论在此。[[a]]\n\n要点在此。\n", ["a"])
        self.assertEqual(text, "结论在此。\n\n要点在此。\n")
        self.assertEqual([(s["text"], s["src"]) for s in segments], [("结论在此。\n\n", ["a"]), ("要点在此。\n", [])])


if __name__ == "__main__":
    unittest.main()
