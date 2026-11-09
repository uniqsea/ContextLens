"""The conversation list kept beside the checkpoints."""
from __future__ import annotations

from contextlens import conversations

from tests.support import StoreTestCase


class ConversationListTests(StoreTestCase):
    def test_a_conversation_is_filed_under_its_project_and_titled_by_its_first_question(self):
        conversations.create("t-1", "proj-a")
        conversations.create("t-2", "ordinary")
        conversations.record_turn("t-1", "proj-a", "  Plan the offsite  ", "Here is a plan [[m1]] with steps.")
        conversations.record_turn("t-1", "proj-a", "And the budget?", "About 2k.")

        row = conversations.get("t-1")
        self.assertEqual((row["scope"], row["title"], row["preview"]), ("proj-a", "Plan the offsite", "About 2k."))
        self.assertEqual([r["id"] for r in conversations.listing("proj-a")], ["t-1"])
        self.assertEqual([r["id"] for r in conversations.listing("ordinary")], ["t-2"])
        self.assertEqual([r["id"] for r in conversations.listing()], ["t-1", "t-2"])  # last answered first

    def test_a_name_the_user_gave_is_kept_and_archiving_and_deleting_change_only_that_row(self):
        conversations.create("t-1", None)
        conversations.rename("t-1", "Offsite")
        conversations.record_turn("t-1", None, "Plan the offsite", "Sure.")
        conversations.set_archived("t-1", True)
        self.assertEqual((conversations.get("t-1")["title"], conversations.get("t-1")["archived"]), ("Offsite", True))
        conversations.delete("t-1")
        self.assertIsNone(conversations.get("t-1"))

    def test_a_turn_in_a_conversation_made_elsewhere_files_it(self):
        conversations.record_turn("t-9", "proj-b", "Hello", "Hi [[f1]]")
        self.assertEqual(conversations.get("t-9")["scope"], "proj-b")
        self.assertEqual(conversations.get("t-9")["preview"], "Hi")

    def test_importing_once_keeps_rows_already_here(self):
        conversations.create("t-1", "proj-a")
        conversations.rename("t-1", "Mine")
        old = {"title": "Old", "titled": 0, "preview": "p", "archived": 1,
               "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-02T00:00:00+00:00"}
        added = conversations.import_rows([{**old, "id": "t-1", "scope": None}, {**old, "id": "t-0", "scope": None}],
                                          "threads")
        self.assertEqual(added, 1)
        self.assertTrue(conversations.imported("threads"))
        self.assertEqual(conversations.get("t-1")["title"], "Mine")
        self.assertEqual((conversations.get("t-0")["scope"], conversations.get("t-0")["archived"]), ("ordinary", True))
