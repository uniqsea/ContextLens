from contextlens import memory
from contextlens.memory import operations as ops

from tests.support import USER, StoreTestCase


def ids(found: dict) -> list[str]:
    return [m["id"] for m in found["memories"]]


class RecallTest(StoreTestCase):
    def test_the_same_person_brings_up_different_memories_in_different_moments(self):
        thesis = self.add("批注更看重论证结构", situation="修改毕业论文第二章", concepts=["导师"])
        career = self.add("推荐信要提前一个月说", situation="盘算找工作还是读博", concepts=["导师"])
        reading = {"doing": "修改毕业论文第二章", "concepts": ["导师"], "scenes": []}
        found = ids(memory.recall("这段怎么改", reading, memory.ORDINARY))
        self.assertEqual(found[0], thesis)
        reading = {"doing": "盘算找工作还是读博", "concepts": ["导师"], "scenes": []}
        found = ids(memory.recall("下一步怎么办", reading, memory.ORDINARY))
        self.assertEqual(found[0], career)

    def test_a_scene_alone_brings_nothing_up(self):
        self.add("团队在上海", scenes=["工作"])
        reading = {"doing": "安排周末", "concepts": [], "scenes": ["工作"]}
        self.assertEqual(ids(memory.recall("去哪玩", reading, memory.ORDINARY)), [])

    def test_a_concept_that_is_everywhere_counts_for_little(self):
        for i in range(30):
            self.add(f"杂事{i}", concepts=["我"])
        rare = self.add("备选方案", concepts=["项目甲"])
        hub = memory.memories_in({memory.ORDINARY})[1].id
        found = memory.recall("随便", {"doing": "", "concepts": ["我", "项目甲"]}, memory.ORDINARY)["memories"]
        self.assertEqual(found[0]["id"], rare)
        self.assertLess(next((m["score"] for m in found if m["id"] == hub), 0), found[0]["score"])

    def test_older_facts_on_a_timeline_do_not_come_up(self):
        old = self.add("正在申请博士", concepts=["我"])
        new = ops.add_memory("决定不读博了", USER, concepts=["我"], replaces=old)[0]["entity_id"]
        found = ids(memory.recall("申请", {"doing": "想想读博", "concepts": ["我"]}, memory.ORDINARY))
        self.assertEqual(found, [new])

    def test_always_on_comes_along_and_a_boundary_holds(self):
        project = ops.create_project("论文", USER)
        fact = self.add("说中文", always_on=True)
        inside = self.add("论文编码规则", scope=project.id)
        ordinary = memory.recall("论文编码规则", {"doing": ""}, memory.ORDINARY)
        self.assertEqual([m["id"] for m in ordinary["always_on"]], [fact])
        self.assertEqual(ids(ordinary), [])
        isolated = memory.recall("论文编码规则", {"doing": ""}, project.id)
        self.assertEqual(isolated["always_on"], [])
        self.assertEqual(ids(isolated), [inside])

    def test_dimming_and_brightening_a_concept(self):
        a = self.add("甲事", concepts=["甲"])
        b = self.add("乙事", concepts=["乙"])
        reading = {"doing": "", "concepts": ["甲"]}
        self.assertEqual(ids(memory.recall("x", reading, memory.ORDINARY)), [a])
        c_a, c_b = ops.concepts_named(["甲"])[0].id, ops.concepts_named(["乙"])[0].id
        self.assertEqual(ids(memory.recall("x", reading, memory.ORDINARY, dim=[c_a])), [])
        self.assertEqual(ids(memory.recall("x", reading, memory.ORDINARY, brighten=[c_b]))[0], b)

    def test_why_is_stated(self):
        self.add("批注看重结构", situation="修改论文", concepts=["导师"], scenes=["工作"])
        found = memory.recall("批注", {"doing": "修改论文", "concepts": ["导师"], "scenes": ["工作"]}, memory.ORDINARY)
        why = found["memories"][0]["why"]
        self.assertEqual(why["concepts"], ["导师"])
        self.assertEqual(why["scenes"], ["工作"])
        self.assertGreater(why["moment"], 0)
        self.assertGreater(why["content"], 0)
