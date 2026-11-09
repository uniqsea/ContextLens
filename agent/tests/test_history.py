"""Searching earlier conversations, and the agent's tool for it. Every conversation here is invented."""
from langchain_core.messages import AIMessage, HumanMessage

from contextlens import conversations, history, memory, models
from contextlens.memory.tools import TurnContext
from tests.support import StoreTestCase, USER, _no_model, reading, structured
from tests.test_passages import Senses


class HistoryTests(StoreTestCase):
    def setUp(self):
        super().setUp()
        self.shared = memory.operations.create_project("Fictional harbour", USER, isolated=False).id
        self.closed = memory.operations.create_project("Fictional vault", USER, isolated=True).id
        for cid, scope in [("plain-1", "ordinary"), ("plain-2", "ordinary"), ("shared-1", self.shared),
                           ("closed-1", self.closed)]:
            conversations.create(cid, scope)
        history.record("plain-1", 0, "When does the north ferry leave?", "At 07:40 on weekdays.[[m1]]")
        history.record("plain-2", 0, "Pick a ferry for Saturday", "Take the 09:00 boat.")
        history.record("shared-1", 0, "Which pier is the ferry using in May?", "Pier 2 while Pier 4 is repainted.")
        history.record("closed-1", 0, "Where is the ferry vault key?", "In the blue drawer.")

    def found(self, query, scope="ordinary", exclude=None):
        return [h["id"] for h in history.search(query, scope, exclude=exclude)]

    def test_each_scope_sees_the_conversations_its_memories_could(self):
        self.assertEqual(set(self.found("ferry")), {"hist-plain-1-0", "hist-plain-2-0"})
        self.assertEqual(set(self.found("ferry", self.shared)), {"hist-plain-1-0", "hist-plain-2-0", "hist-shared-1-0"})
        self.assertEqual(self.found("ferry", self.closed), ["hist-closed-1-0"])
        self.assertEqual(self.found("ferry", exclude="plain-1"), ["hist-plain-2-0"])  # not the one being had

    def test_a_hit_shows_the_turn_without_citation_markers(self):
        [hit] = history.search("weekdays", "ordinary")
        # An untitled conversation goes by its question.
        self.assertEqual((hit["title"], hit["turn"]), ("When does the north ferry leave?", 0))
        self.assertIn("When does the north ferry leave?", hit["excerpt"])
        self.assertIn("At 07:40 on weekdays.", hit["excerpt"])
        self.assertNotIn("[[", hit["excerpt"])

    def test_an_answer_given_again_replaces_the_old_one_and_a_deleted_conversation_is_gone(self):
        history.record("plain-1", 0, "When does the north ferry leave?", "At 08:15 from next month.")
        self.assertEqual(self.found("weekdays"), [])
        self.assertEqual(self.found("month"), ["hist-plain-1-0"])
        history.forget("plain-1")
        self.assertEqual(self.found("month"), [])

    def test_meaning_finds_a_turn_asked_in_another_language_once_it_has_vectors(self):
        models.use(_no_model, embedding=("local/senses", Senses()))
        self.assertEqual(self.found("船票多少钱"), [])
        history.record("plain-1", 1, "How much is a crossing?", "A single crossing costs 6 credits.")
        self.assertGreater(history.embed_pending(), 0)
        self.assertEqual(self.found("船票多少钱")[0], "hist-plain-1-1")

    def test_conversations_from_before_history_was_kept_are_brought_in_once(self):
        from langgraph.checkpoint.sqlite import SqliteSaver

        from contextlens.config import conversations_path
        from contextlens.graph import _builder

        self.script("The lamp oil is in shed three.", memory=[reading("asking about lamp oil"),
                                                              structured("Lessons", lessons=[])])
        with SqliteSaver.from_conn_string(str(conversations_path())) as saver:
            _builder.compile(checkpointer=saver).invoke(
                {"messages": [HumanMessage(content="Where is the lamp oil?")]}, {"configurable": {"thread_id": "old-1"}})
        self.assertEqual(self.found("lamp oil"), ["hist-old-1-0"])  # answered turns are kept as they happen
        history.forget("old-1")  # as if answered before history was kept
        with history._session() as conn:
            conn.execute("DELETE FROM conversation_marks WHERE key = ?", (history._BACKFILL,))
        self.assertEqual(self.found("lamp oil"), ["hist-old-1-0"])
        history.forget("old-1")
        self.assertEqual(self.found("lamp oil"), [])  # brought in only once

    def test_the_agent_searches_history_and_cites_what_it_found(self):
        from langgraph.checkpoint.memory import InMemorySaver

        from contextlens.graph import _builder

        call = AIMessage(content="", tool_calls=[{"name": "search_history", "id": "h", "args": {"query": "ferry Saturday"}}])
        self.script(call, "Last time you took the 09:00 boat.[[t1]]", memory=[
            reading("planning a ferry trip"), structured("Lessons", lessons=[])])
        out = _builder.compile(checkpointer=InMemorySaver()).invoke(
            {"messages": [HumanMessage(content="Which ferry did I take on Saturday?")]},
            {"configurable": {"thread_id": "plain-1"}})
        version = out["turn_records"]["0"]["versions"][0]
        self.assertIn("[t1]", version["steps"][0]["result"])
        self.assertEqual(version["labels"]["t1"], "hist-plain-2-0")
        [card] = [c for c in version["candidates"] if c["id"] == "hist-plain-2-0"]
        self.assertEqual((card["layer"], card["status"]), ("short_term", "active"))
        self.assertEqual(version["segments"][0]["src"], ["hist-plain-2-0"])

    def test_the_tool_says_so_when_nothing_matches(self):
        ctx = TurnContext(question="q", scope="ordinary", thread_id="plain-1")
        text, artifact = history.search_history.func("lighthouse paint", type("R", (), {"context": ctx})())
        self.assertEqual((text, artifact), ("No earlier conversation matches.", {"history": []}))
