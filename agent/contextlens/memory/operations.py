"""The things that can be done to memory, in the system's own terms. Callers say what they mean;
this module builds the new entities and hands them to the ledger. Who may see what is decided here.
"""
from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timezone

from . import ledger
from .store import all_of, get, memories_in
from .types import ORDINARY, Concept, Memory, MemoryError, Project, Question, Scene, Source

SELF = "我"
_SELF_ALIASES = ["me", "i", "user", "用户"]
_EDITABLE = ("learned", "situation", "always_on", "check_at")


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ---------- scope ----------

def visible_scopes(scope: str) -> set[str]:
    """Ordinary sessions see ordinary memories. Projects see their own, and shared ones also ordinary."""
    if scope == ORDINARY:
        return {ORDINARY}
    project = get(Project, scope)
    if project is None:
        raise MemoryError("No such project.")
    return {scope} if project.isolated else {scope, ORDINARY}


def visible_memory(memory_id: str, scope: str) -> Memory:
    memory = get(Memory, memory_id)
    if memory is None or memory.scope not in visible_scopes(scope):
        raise MemoryError("No such memory here.")
    return memory


# ---------- memories ----------

def add_memory(learned: str, source: Source, *, scope: str = ORDINARY, situation: str = "", origin: str = "said",
               concepts: list[str] | None = None, scenes: list[str] | None = None, check_at: str | None = None,
               always_on: bool = False, replaces: str | None = None, noted: str | None = None) -> list[dict]:
    """A new memory. With `replaces`, a real change: the older fact stays on the timeline. `noted` is
    when it was learned, if that was before now (an imported fact keeps its own date)."""
    if not learned.strip():
        raise MemoryError("A memory needs something learned.")
    links = _resolve_concepts(concepts or [], source)
    memory = Memory(id=_id("m"), scope=scope, learned=learned.strip(), situation=situation.strip(), source=origin,
                    concepts=[c.id for c in links], scenes=scenes or [], check_at=check_at, always_on=always_on,
                    created_at=f"{noted}T00:00:00+00:00" if noted else _now())
    older = []
    if replaces:
        previous = get(Memory, replaces)
        if previous is None:
            raise MemoryError("No such memory to replace.")
        older = [replace(previous, state="superseded", superseded_by=memory.id)]
    return ledger.commit(source, "superseded" if older else "created", memory, *older)


def revise(memory_id: str, changes: dict, source: Source) -> list[dict]:
    """Correct a memory in place: what it said was wrong, as opposed to the world having changed."""
    memory = _require(memory_id)
    values = {k: v.strip() if isinstance(v, str) else v for k, v in changes.items() if k in _EDITABLE}
    if values.get("learned") == "":
        raise MemoryError("A memory needs something learned.")
    return ledger.commit(source, "revised", replace(memory, **values))


def supersede_with(memory_id: str, by_id: str, source: Source) -> list[dict]:
    """A later memory turned out to take over from an earlier one: join them on a timeline."""
    older = replace(_require(memory_id), state="superseded", superseded_by=_require(by_id).id)
    return ledger.commit(source, "superseded", older)


def relabel(memory_ids: list[str], situation: str, scenes: list[str], source: Source) -> list[dict]:
    """The user corrected what was going on: memories written in that moment follow."""
    # Some may have been undone or deleted since.
    held = [m for m in (get(Memory, i) for i in memory_ids) if m]
    return ledger.commit(source, "revised", *[replace(m, situation=situation, scenes=scenes) for m in held])


def forget(memory_id: str, source: Source) -> list[dict]:
    return ledger.commit(source, "forgotten", replace(_require(memory_id), state="forgotten"))


def restore(memory_id: str, source: Source) -> list[dict]:
    return ledger.commit(source, "restored", replace(_require(memory_id), state="active"))


def timeline(memory_id: str) -> list[Memory]:
    """The facts this one belongs to, oldest first: what was true, and what replaced it."""
    memory = _require(memory_id)
    memories = {m.id: m for m in all_of(Memory)}
    earlier = {m.superseded_by: m for m in memories.values() if m.superseded_by}
    while memory.id in earlier:
        memory = earlier[memory.id]
    chain = [memory]
    while chain[-1].superseded_by in memories:
        chain.append(memories[chain[-1].superseded_by])
    return chain


# ---------- concepts ----------

def _resolve_concepts(names: list[str], source: Source) -> list[Concept]:
    """Concepts by name or alias, creating the ones that do not exist yet. New ones are their own
    change: undoing a memory leaves its concept behind, unseen until another memory links to it."""
    known = _names_index()
    found: dict[str, Concept] = {}
    created = []
    for name in filter(None, map(str.strip, names)):
        concept = known.get(name.lower())
        if concept is None:
            concept = known[name.lower()] = _new_concept(name)
            created.append(concept)
        found[concept.id] = concept
    if created:
        ledger.commit(source, "created", *created, alone=True)
    return list(found.values())


def _new_concept(name: str) -> Concept:
    aliases = _SELF_ALIASES if name == SELF else []
    return Concept(id=_id("c"), name=name, aliases=aliases)


def _names_index() -> dict[str, Concept]:
    index = {}
    for concept in all_of(Concept):
        if not concept.merged_into:
            for name in (concept.name, *concept.aliases):
                index[name.lower()] = concept
    return index


def concepts_named(names: list[str]) -> list[Concept]:
    index = _names_index()
    return list({index[n.lower()].id: index[n.lower()] for n in names if n.lower() in index}.values())


def concept_ids(names: list[str], source: Source) -> list[str]:
    return [c.id for c in _resolve_concepts(names, source)]


def link_concepts(memory_id: str, names: list[str], source: Source) -> list[dict]:
    memory = _require(memory_id)
    links = _resolve_concepts(names, source)
    merged = list(dict.fromkeys([*memory.concepts, *[c.id for c in links]]))
    return ledger.commit(source, "linked", replace(memory, concepts=merged))


def concepts_in(scope: str, allowed_ids: set[str] | None = None) -> list[dict]:
    """Concepts the scope can see (a concept shows only through a memory visible here), with counts."""
    memories = memories_in(visible_scopes(scope))
    counts: dict[str, int] = {}
    for memory in memories:
        if allowed_ids is not None and memory.id not in allowed_ids:
            continue
        for concept_id in memory.concepts:
            counts[concept_id] = counts.get(concept_id, 0) + 1
    rows = [{"id": c.id, "name": c.name, "aliases": c.aliases, "part_of": c.part_of, "count": counts[c.id]}
            for c in all_of(Concept) if c.id in counts and not c.merged_into]
    return sorted(rows, key=lambda r: (-r["count"], r["name"]))


def rename_concept(concept_id: str, name: str, aliases: list[str] | None, source: Source) -> list[dict]:
    concept = _require_concept(concept_id)
    if not name.strip():
        raise MemoryError("A concept needs a name.")
    return ledger.commit(source, "revised", replace(concept, name=name.strip(),
                                                    aliases=concept.aliases if aliases is None else aliases))


def merge_concepts(keep_id: str, drop_id: str, source: Source) -> list[dict]:
    """Two names for one thing: memories move over and the name stays as an alias."""
    keep, drop = _require_concept(keep_id), _require_concept(drop_id)
    if keep.id == drop.id:
        raise MemoryError("A concept cannot merge with itself.")
    moved = [replace(m, concepts=list(dict.fromkeys(keep.id if c == drop.id else c for c in m.concepts)))
             for m in all_of(Memory) if drop.id in m.concepts]
    aliases = list(dict.fromkeys([*keep.aliases, drop.name, *drop.aliases]))
    return ledger.commit(source, "merged", replace(keep, aliases=aliases), replace(drop, merged_into=keep.id), *moved)


def split_concept(concept_id: str, name: str, memory_ids: list[str], source: Source) -> list[dict]:
    """One name for two things: the given memories move to a new concept."""
    concept = _require_concept(concept_id)
    if not name.strip():
        raise MemoryError("A concept needs a name.")
    new = _new_concept(name.strip())
    moved = [replace(m, concepts=[new.id if c == concept.id else c for c in m.concepts])
             for m in map(_require, memory_ids)]
    return ledger.commit(source, "split", new, *moved)


# ---------- scenes ----------

PRESET_SCENES = [
    {"name": "工作", "definition": "为职业、收入或对外交付负责：项目、投稿、求职、面试、副业。"},
    {"name": "学习", "definition": "为了自己掌握，或完成学业要求：上课、学新东西、读论文求理解、毕业论文。"},
    {"name": "生活", "definition": "维持日常和个人享受：健康、饮食、家务、理财、关系、娱乐、出行。"},
]


def active_scenes() -> list[Scene]:
    return [s for s in all_of(Scene) if s.state == "active"]


def save_scenes(wanted: list[dict], source: Source) -> list[dict]:
    """The user's list, exactly. A renamed scene takes its memories' labels with it. One left out stops
    being used and is not proposed again; memories keep its label."""
    existing = all_of(Scene)
    by_id, by_name = {s.id: s for s in existing}, {s.name: s for s in existing}
    chosen, renamed = [], {}
    for item in wanted:
        name = str(item.get("name", "")).strip()
        if not name:
            raise MemoryError("A scene needs a name.")
        was = by_id.get(item.get("id")) or by_name.get(name) or Scene(id=_id("s"), name=name)
        chosen.append(replace(was, name=name, definition=str(item.get("definition", "")).strip(), state="active"))
        if was.name != name:
            renamed[was.name] = name
    if len({s.name for s in chosen}) < len(chosen):
        raise MemoryError("Two scenes cannot share a name.")
    kept = {s.id for s in chosen}
    dropped = [replace(s, state="dismissed") for s in existing if s.state == "active" and s.id not in kept]
    relabelled = [replace(m, scenes=list(dict.fromkeys(renamed.get(s, s) for s in m.scenes)))
                  for m in all_of(Memory) if renamed.keys() & set(m.scenes)]
    return ledger.commit(source, "chosen", *chosen, *dropped, *relabelled)


def preset_scenes_if_never_chosen() -> None:
    """A store that has never had a scene starts from the presets; removing them later stays removed."""
    if not all_of(Scene):
        save_scenes(PRESET_SCENES, Source("seed"))


def propose_scene(name: str, reason: str, source: Source, definition: str = "") -> list[dict]:
    """A new scene exists only after the user agrees. Asked once: a dismissal stands."""
    name = name.strip()
    if not name:
        raise MemoryError("A scene needs a name.")
    if any(s.name == name for s in all_of(Scene)):
        return []
    return ledger.commit(source, "proposed", Scene(id=_id("s"), name=name, definition=definition.strip(),
                                                   state="proposed", reason=reason))


def decide_scene(scene_id: str, accept: bool, source: Source) -> list[dict]:
    scene = get(Scene, scene_id)
    if scene is None:
        raise MemoryError("No such scene.")
    return ledger.commit(source, "accepted" if accept else "dismissed",
                         replace(scene, state="active" if accept else "dismissed"))


# ---------- projects ----------

def create_project(name: str, source: Source, isolated: bool = True, *, conn=None) -> Project:
    if not name.strip():
        raise MemoryError("A project needs a name.")
    project = Project(id=_id("p"), name=name.strip(), isolated=isolated)
    ledger.commit(source, "created", project, conn=conn)
    return project


def set_isolated(project_id: str, isolated: bool, source: Source) -> list[dict]:
    project = get(Project, project_id)
    if project is None:
        raise MemoryError("No such project.")
    return ledger.commit(source, "revised", replace(project, isolated=isolated))


# ---------- questions ----------

def ask(text: str, scope: str, memory_ids: list[str], source: Source) -> list[dict]:
    return ledger.commit(source, "asked", Question(id=_id("q"), scope=scope, text=text, memory_ids=memory_ids))


def answer_question(question_id: str, answer: str, source: Source) -> list[dict]:
    question = get(Question, question_id)
    if question is None:
        raise MemoryError("No such question.")
    return ledger.commit(source, "answered", replace(question, state="answered", answer=answer))


def open_questions(scope: str) -> list[Question]:
    return [q for q in all_of(Question) if q.state == "open" and q.scope == scope]


def _require(memory_id: str) -> Memory:
    memory = get(Memory, memory_id)
    if memory is None:
        raise MemoryError("No such memory, or it was deleted for good.")
    return memory


def _require_concept(concept_id: str) -> Concept:
    concept = get(Concept, concept_id)
    if concept is None or concept.merged_into:
        raise MemoryError("No such concept.")
    return concept


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
