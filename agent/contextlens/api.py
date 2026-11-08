"""HTTP routes served next to the LangGraph API (see langgraph.json `http.app`).

- /lens/preview: the composer previews the next request on every keystroke, so it calls context
  assembly directly instead of going through a graph run.
- /lens/settings: providers, keys and the model for each role. Keys go in, never out. Also the
  language memories are written in.
- /lens/memories, /lens/memory-events: the memory library and its history. Every change made here
  is recorded as the user's and can be undone like any other.
- /lens/import: pasted text read into candidate memories, then the ones the user kept written as
  one batch.
- /lens/overview, /lens/scenes, /lens/projects, /lens/concepts, /lens/questions: what surrounds the
  memories: where they can be looked at from, and what waits on the user.

Only the Next.js server calls these. Browsers always send Origin on cross-site requests, so any
request that carries one is refused: no other web page can reach them through the user's browser.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import asdict

from setproctitle import setproctitle
from langchain_core.messages import convert_to_messages
from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from contextlens import memory, models, project_files, projects, records
from contextlens.context import prepare_snapshot
from contextlens.memory import search
from contextlens.models import local_embedding

# The reload supervisor starts a separate worker that imports this ASGI app.
if process_title := os.environ.get("CONTEXTLENS_AGENT_TITLE"):
    setproctitle(process_title)


class RefuseBrowsers(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if "origin" in request.headers:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        return await call_next(request)


# No docstrings on handlers: the API server parses route docstrings as OpenAPI YAML.
# Settings and SQLite touch the disk synchronously; every such call runs off the event loop.
# The tokenizer and a local embedding model are slow to load and large to keep. They stay loaded
# while previews keep coming, and are released once none has come for a while.
SEARCH_IDLE_SECONDS = 600
_release_timer = None


def _release_search():
    search.release_caches()
    local_embedding.release_cache()


def _search_used():
    """Push back the release; runs on the event loop."""
    global _release_timer
    if _release_timer:
        _release_timer.cancel()
    _release_timer = asyncio.get_running_loop().call_later(SEARCH_IDLE_SECONDS, _release_search)


async def _warm_preview_search(has_memories: bool):
    def warm():
        search.tokenizer().initialize()
        if has_memories and not models.role_spec("embedding"):
            models.embedding_model()

    await asyncio.to_thread(warm)
    _search_used()


async def preview(request: Request) -> JSONResponse:
    body = await request.json()
    state = {
        "messages": convert_to_messages(body.get("messages") or []),
        "history_lineage": body.get("history_lineage") or {},
        "project_id": body.get("project_id"),
        "context_policies": body.get("context_policies") or [],
        "manual_memory_ids": body.get("manual_memory_ids") or [],
        "input_order": body.get("input_order"),
        "include_inventory": True,
    }
    try:
        # SQLite reads are synchronous; keep them off the event loop.
        snapshot = await asyncio.to_thread(prepare_snapshot, state)
        _search_used()
        warmup = None
        if not state["messages"] or not state["messages"][-1].content:
            has_memories = any(c["layer"] == "memory" and not c["always_on"]
                               and c["status"] not in {"trashed", "temporarily_ignored"} for c in snapshot["candidates"])
            warmup = BackgroundTask(_warm_preview_search, has_memories)
        return JSONResponse(snapshot, background=warmup)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def settings_overview(request: Request) -> JSONResponse:
    return JSONResponse(await asyncio.to_thread(models.overview))


async def provider_models(request: Request) -> JSONResponse:
    listed = await asyncio.to_thread(models.model_list, request.path_params["provider"])
    if listed is None:
        return JSONResponse({"error": "unknown provider"}, status_code=404)
    return JSONResponse({"models": listed})


async def save_shown(request: Request) -> JSONResponse:
    pid = request.path_params["provider"]
    if pid not in await asyncio.to_thread(models.providers):
        return JSONResponse({"error": "unknown provider"}, status_code=404)
    await asyncio.to_thread(models.settings.set_shown, pid, (await request.json()).get("models"))
    return JSONResponse({"models": await asyncio.to_thread(models.model_list, pid)})


async def save_provider(request: Request) -> JSONResponse:
    pid = request.path_params["provider"]
    if request.method == "DELETE":
        await asyncio.to_thread(models.settings.forget_provider, pid)
    else:
        body = await request.json()
        if pid not in await asyncio.to_thread(models.providers):
            return JSONResponse({"error": "unknown provider"}, status_code=404)
        await asyncio.to_thread(models.settings.save_provider, pid, body.get("api_key"), body.get("base_url"))
    return JSONResponse(await asyncio.to_thread(models.overview))


async def save_roles(request: Request) -> JSONResponse:
    try:
        await asyncio.to_thread(models.settings.set_roles, await request.json())
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse(await asyncio.to_thread(models.overview))


async def save_efforts(request: Request) -> JSONResponse:
    try:
        await asyncio.to_thread(models.settings.set_efforts, await request.json())
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse(await asyncio.to_thread(models.overview))


async def memory_language(request: Request) -> JSONResponse:
    body = await request.json() if request.method == "PUT" else {}
    try:
        return JSONResponse(await asyncio.to_thread(memory.language.choose, body.get("choice"), body.get("interface")))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def test_model(request: Request) -> JSONResponse:
    body = await request.json()
    return JSONResponse(await asyncio.to_thread(models.test, body["provider"], body["model"], body.get("kind", "chat")))


# ---------- memory library ----------

_USER = memory.Source("user")
_ACTIONS = {"trash": memory.operations.forget, "restore": memory.operations.restore, "purge": memory.purge}


def _scope(request: Request) -> str:
    return request.query_params.get("scope") or memory.ORDINARY


async def memories_index(request: Request) -> JSONResponse:
    scope = _scope(request)
    if request.method == "POST":
        return await _change(lambda body: records.create(body, scope, _USER), request)
    include_trashed = request.query_params.get("include_trashed") == "1"
    if request.query_params.get("view") == "library":
        owner = request.query_params.get("scope")
        return await _read(lambda: {"memories": records.library_records(owner, include_trashed)})
    return await _read(lambda: {"memories": records.records(scope, include_trashed)})


async def memory_item(request: Request) -> JSONResponse:
    mid = request.path_params["memory_id"]
    return await _change(lambda body: records.revise(mid, body, _USER, body.get("revision")), request)


async def memory_action(request: Request) -> JSONResponse:
    mid, action = request.path_params["memory_id"], request.path_params["action"]
    if action not in _ACTIONS:
        return JSONResponse({"error": "unknown action"}, status_code=404)
    return await _change(lambda body: _ACTIONS[action](mid, _USER), request)


async def memory_timeline(request: Request) -> JSONResponse:
    return await _read(lambda: {"timeline": records.timeline(request.path_params["memory_id"])})


async def import_preview(request: Request) -> JSONResponse:
    body = await request.json()
    try:
        return JSONResponse(await asyncio.to_thread(memory.importing.propose, str(body.get("text", "")), _scope(request)))
    except memory.MemoryError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:  # a provider failure; the user needs to see what kind
        return JSONResponse({"error": type(e).__name__}, status_code=502)


async def import_commit(request: Request) -> JSONResponse:
    body = await request.json()
    return await _read(lambda: {"events": records.changes(memory.importing.commit(body.get("items", []), _scope(request)))})


async def overview(request: Request) -> JSONResponse:
    return await _read(records.overview, _scope(request))


async def concept_item(request: Request) -> JSONResponse:
    cid = request.path_params["id"]
    return await _plain_change(lambda b: memory.operations.rename_concept(cid, b.get("name", ""), b.get("aliases"), _USER),
                               request)


async def concept_merge(request: Request) -> JSONResponse:
    return await _plain_change(lambda b: memory.operations.merge_concepts(b["keep"], b["drop"], _USER), request)


async def concept_split(request: Request) -> JSONResponse:
    cid = request.path_params["id"]
    return await _plain_change(
        lambda b: memory.operations.split_concept(cid, b.get("name", ""), b.get("memory_ids", []), _USER), request)


async def scenes_index(request: Request) -> JSONResponse:
    return await _plain_change(lambda b: memory.operations.save_scenes(b.get("scenes", []), _USER), request)


async def scenes_suggest(request: Request) -> JSONResponse:
    body = await request.json()
    description = str(body.get("description", "")).strip()
    if not description:
        return JSONResponse({"error": "Say how you use it first."}, status_code=400)
    try:
        found = await asyncio.to_thread(memory.suggest_situations, description, body.get("current", []))
    except Exception as e:  # a provider or settings failure; the user needs to see what kind
        return JSONResponse({"error": type(e).__name__}, status_code=502)
    return JSONResponse({"situations": found})


async def scene_decision(request: Request) -> JSONResponse:
    sid, accept = request.path_params["id"], request.path_params["decision"] == "accept"
    return await _plain_change(lambda b: memory.operations.decide_scene(sid, accept, _USER), request)


async def project_folders(request: Request) -> JSONResponse:
    project_id = request.path_params["id"]
    if request.method == "GET":
        return await _read(project_files.folders, project_id)
    body = await request.json()
    return await _read(project_files.attach, project_id, body.get("paths") if isinstance(body, dict) else None)


async def choose_folder_paths(request: Request) -> JSONResponse:
    return await _read(project_files.choose_paths)


async def pick_project_folders(request: Request) -> JSONResponse:
    return await _read(project_files.pick, request.path_params["id"])


async def list_project_files(request: Request) -> JSONResponse:
    return await _read(project_files.list_files, request.path_params["id"], request.path_params["folder_id"],
                       request.query_params.get("directory"), request.query_params.get("q", "").strip())


async def document_thumbnail(request: Request) -> Response:
    from contextlens.project_files.thumbnails import thumbnail
    try:
        data, mime = await asyncio.to_thread(thumbnail, request.path_params["id"], request.path_params["source_id"])
        return Response(data, media_type=mime, headers={"Cache-Control": "private, no-store",
                        "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
                        "X-Content-Type-Options": "nosniff"})
    except memory.MemoryError:
        return Response(status_code=404)


async def detach_project_folder(request: Request) -> JSONResponse:
    return await _read(project_files.detach, request.path_params["id"], request.path_params["folder_id"])


async def project_settings(request: Request) -> JSONResponse:
    return await _read(projects.configure, request.path_params["id"], await request.json())


async def projects_index(request: Request) -> JSONResponse:
    if request.method == "GET":
        return await _read(projects.directory)
    body = await request.json()
    return await _read(lambda: asdict(project_files.create_with_folders(
        body.get("name", ""), _USER, body.get("paths", []),
        instructions=body.get("instructions", ""), isolated=body.get("isolated", True))))


async def project_item(request: Request) -> JSONResponse:
    if request.method == "DELETE":
        return await _read(projects.remove_local, request.path_params["id"])
    if request.method == "PUT":
        return await _read(project_files.edit_project, request.path_params["id"], _USER, await request.json())
    pid = request.path_params["id"]
    return await _plain_change(lambda b: memory.operations.set_isolated(pid, bool(b["isolated"]), _USER), request)


async def question_item(request: Request) -> JSONResponse:
    qid = request.path_params["id"]
    return await _plain_change(lambda b: memory.operations.answer_question(qid, b.get("answer", ""), _USER), request)


async def _read(work, *args) -> JSONResponse:
    try:
        return JSONResponse(await asyncio.to_thread(work, *args))
    except memory.MemoryError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def _plain_change(apply, request: Request) -> JSONResponse:
    """A change to something other than a memory: answer with its events."""
    body = await request.json() if await request.body() else {}
    return await _read(lambda: {"events": apply(body)})


async def memory_history(request: Request) -> JSONResponse:
    mid = request.path_params["memory_id"]
    return JSONResponse({"events": await asyncio.to_thread(records.events, mid)})


async def memory_events(request: Request) -> JSONResponse:
    q = request.query_params
    events = await asyncio.to_thread(records.events, None, q.get("thread_id"), int(q.get("limit", 100)),
                                     int(q["before"]) if q.get("before") else None, q.get("scope"))
    return JSONResponse({"events": events})


async def revert_event(request: Request) -> JSONResponse:
    event_id = int(request.path_params["event_id"])
    return await _change(lambda body: memory.revert(event_id, _USER), request)


async def _change(apply, request: Request) -> JSONResponse:
    """Run one change; answer with the event and the memory as it now stands."""
    body = await request.json() if request.method != "GET" and await request.body() else {}
    try:
        changed = records.changes(await asyncio.to_thread(apply, body))
    except records.Conflict as e:
        return JSONResponse({"error": str(e)}, status_code=409)
    except (memory.MemoryError, KeyError) as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    event = changed[0] if changed else None
    current = await asyncio.to_thread(records.one, event["memory_id"]) if event else None
    return JSONResponse({"event": event, "memory": current})


app = Starlette(
    routes=[
        Route("/lens/preview", preview, methods=["POST"]),
        Route("/lens/settings", settings_overview, methods=["GET"]),
        Route("/lens/settings/providers/{provider}/models", provider_models, methods=["GET"]),
        Route("/lens/settings/providers/{provider}/shown", save_shown, methods=["PUT"]),
        Route("/lens/settings/providers/{provider}", save_provider, methods=["PUT", "DELETE"]),
        Route("/lens/settings/roles", save_roles, methods=["PUT"]),
        Route("/lens/settings/efforts", save_efforts, methods=["PUT"]),
        Route("/lens/settings/test", test_model, methods=["POST"]),
        Route("/lens/settings/memory-language", memory_language, methods=["GET", "PUT"]),
        Route("/lens/overview", overview, methods=["GET"]),
        Route("/lens/concepts/merge", concept_merge, methods=["POST"]),
        Route("/lens/concepts/{id}", concept_item, methods=["PATCH"]),
        Route("/lens/concepts/{id}/split", concept_split, methods=["POST"]),
        Route("/lens/scenes", scenes_index, methods=["POST"]),
        Route("/lens/scenes/suggest", scenes_suggest, methods=["POST"]),
        Route("/lens/scenes/{id}/{decision}", scene_decision, methods=["POST"]),
        Route("/lens/folder-picker", choose_folder_paths, methods=["POST"]),
        Route("/lens/projects", projects_index, methods=["GET", "POST"]),
        Route("/lens/projects/{id}/folders", project_folders, methods=["GET", "POST"]),
        Route("/lens/projects/{id}/folders/pick", pick_project_folders, methods=["POST"]),
        Route("/lens/projects/{id}/files/{source_id}/thumbnail", document_thumbnail, methods=["GET"]),
        Route("/lens/projects/{id}/folders/{folder_id}/files", list_project_files, methods=["GET"]),
        Route("/lens/projects/{id}/folders/{folder_id}", detach_project_folder, methods=["DELETE"]),
        Route("/lens/projects/{id}/settings", project_settings, methods=["PATCH"]),
        Route("/lens/projects/{id}", project_item, methods=["PATCH", "PUT", "DELETE"]),
        Route("/lens/questions/{id}", question_item, methods=["POST"]),
        Route("/lens/memories", memories_index, methods=["GET", "POST"]),
        Route("/lens/memories/{memory_id}", memory_item, methods=["PATCH"]),
        Route("/lens/memories/{memory_id}/events", memory_history, methods=["GET"]),
        Route("/lens/memories/{memory_id}/timeline", memory_timeline, methods=["GET"]),
        Route("/lens/memories/{memory_id}/{action}", memory_action, methods=["POST"]),
        Route("/lens/memory-events", memory_events, methods=["GET"]),
        Route("/lens/import/preview", import_preview, methods=["POST"]),
        Route("/lens/import", import_commit, methods=["POST"]),
        Route("/lens/memory-events/{event_id:int}/revert", revert_event, methods=["POST"]),
    ],
    middleware=[Middleware(RefuseBrowsers)],
)
