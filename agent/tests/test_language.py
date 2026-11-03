from contextlens import memory
from contextlens.memory import language
from tests.support import StoreTestCase, structured


class LanguageTests(StoreTestCase):
    def test_memories_follow_the_interface_until_the_user_picks_one(self):
        self.assertEqual(language.current(), "zh")
        language.settings.set_memory_language(interface="en")
        self.assertEqual(language.current(), "en")
        language.settings.set_memory_language(choice="zh")
        language.settings.set_memory_language(interface="en")
        self.assertEqual(language.current(), "zh")

    def test_a_new_language_rewrites_what_is_there_as_undoable_events(self):
        kept = self.add("Ada", situation="")
        changed = self.add("对芝麻过敏", situation="计划聚餐")
        language.settings.set_memory_language(choice="en")
        self.script(memory=[structured("Rewrites", memories=[
            {"id": kept, "learned": "Ada", "situation": ""},
            {"id": changed, "learned": "Allergic to sesame", "situation": "planning a dinner"},
            {"id": "m-unknown", "learned": "made up"}])])
        events = language.rewrite()
        self.assertEqual(len(events), 1)
        rewritten = memory.get(memory.Memory, changed)
        self.assertEqual((rewritten.learned, rewritten.situation), ("Allergic to sesame", "planning a dinner"))
        self.assertIn("English", str(self.memory_model.calls[0][0].content))
        self.assertEqual(language._written(), "en")
        memory.revert(events[0]["id"], memory.Source("user"))
        self.assertEqual(memory.get(memory.Memory, changed).learned, "对芝麻过敏")

    def test_prompts_name_the_memory_language(self):
        language.settings.set_memory_language(choice="en")
        self.script(memory=[structured("Lessons", lessons=[])])
        memory.remember_turn("我对芝麻过敏", {}, memory.ORDINARY, memory.Source("user"))
        self.assertIn("in English", str(self.memory_model.calls[0][0].content))
