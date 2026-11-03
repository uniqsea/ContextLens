"""Which providers and models exist, from models.dev (MIT). Cached locally; works offline.

Only providers reachable through the OpenAI-compatible API are kept, since every model call goes
through ChatOpenAI with a base URL. Within a provider only usable models are kept (newest first), and
the current ones are marked so a picker can lead with them.
"""
from __future__ import annotations

import json
import time

import httpx

from contextlens import config

SOURCE = "https://models.dev/api.json"
MAX_AGE_SECONDS = 24 * 3600
CACHE_VERSION = 2
_COMPATIBLE = {"@ai-sdk/openai-compatible", "@ai-sdk/openai"}
_DEFAULT_URLS = {"openai": "https://api.openai.com/v1"}

# Used when models.dev cannot be reached and nothing is cached yet.
_FALLBACK = {
    "deepseek": {"id": "deepseek", "name": "DeepSeek", "api": "https://api.deepseek.com",
                 "npm": "@ai-sdk/openai-compatible",
                 "doc": "https://api-docs.deepseek.com",
                 "models": {"deepseek-flash": {"name": "DeepSeek Flash", "family": "deepseek-flash",
                                               "tool_call": True, "reasoning": True, "release_date": "2026-10-17",
                                               "reasoning_options": [{"type": "toggle"},
                                                                     {"type": "effort", "values": ["low", "high", "max"]}]},
                            "deepseek-v4-pro": {"name": "DeepSeek V4 Pro", "family": "deepseek-thinking",
                                                "tool_call": True, "reasoning": True, "release_date": "2026-08-13",
                                                "reasoning_options": [{"type": "toggle"},
                                                                      {"type": "effort", "values": ["low", "high", "max"]}]}}},
    "openai": {"id": "openai", "name": "OpenAI", "api": None, "npm": "@ai-sdk/openai",
               "doc": "https://platform.openai.com/docs/models",
               "models": {"gpt-5-mini": {"name": "GPT-5 Mini", "family": "gpt-mini", "tool_call": True,
                                         "reasoning": True, "release_date": "2025-08-07",
                                         "reasoning_options": [{"type": "effort",
                                                                "values": ["minimal", "low", "medium", "high"]}]},
                          "text-embedding-3-small": {"name": "text-embedding-3-small", "family": "text-embedding"}}},
}

_memo: tuple[float, dict] | None = None


def providers() -> dict[str, dict]:
    """Supported providers by id: name, base_url, doc and their usable models."""
    global _memo
    if _memo and time.time() - _memo[0] < MAX_AGE_SECONDS:
        return _memo[1]
    cache = config.home() / "models-catalog.json"
    cached = _read_cache(cache)
    if cached is not None and time.time() - cache.stat().st_mtime < MAX_AGE_SECONDS:
        data = cached
    else:
        try:
            data = _normalize(_fetch())
            config.ensure_home()
            cache.write_text(json.dumps({"version": CACHE_VERSION, "providers": data}, ensure_ascii=False))
        except (httpx.HTTPError, ValueError):
            # Offline: a stale copy beats the minimal fallback.
            data = cached if cached is not None else _normalize(_FALLBACK)
    _memo = (time.time(), data)
    return data


def _read_cache(cache) -> dict | None:
    """The cached catalog, or None when missing or written in an older shape."""
    if not cache.exists():
        return None
    data = json.loads(cache.read_text())
    return data.get("providers") if data.get("version") == CACHE_VERSION else None


def _normalize(raw: dict) -> dict:
    return {pid: _provider(p) for pid, p in raw.items()
            if p.get("npm") in _COMPATIBLE and (p.get("api") or pid in _DEFAULT_URLS)}


def _provider(raw: dict) -> dict:
    listed = raw.get("models", {})
    models = {}
    for mid, m in sorted(listed.items(), key=lambda kv: kv[1].get("release_date") or "", reverse=True):
        if m.get("status") == "deprecated" or _is_alias(raw["id"], mid, m, listed):
            continue
        embedding = m.get("type") == "embedding" or "embed" in mid or "embedding" in (m.get("family") or "")
        chat = m.get("type") in (None, "chat") and "text" in ((m.get("modalities") or {}).get("output") or ["text"])
        if not (embedding or (chat and m.get("tool_call"))):
            continue  # the agent needs tool calls on text; realtime, image and the like are of no use here
        cost = m.get("cost") or {}
        models[mid] = {"id": mid, "name": m.get("name") or mid, "kind": "embedding" if embedding else "chat",
                       "family": m.get("family"), "release_date": m.get("release_date"),
                       "reasoning": bool(m.get("reasoning")), "efforts": _efforts(m),
                       "context": (m.get("limit") or {}).get("context"),
                       "cost_input": cost.get("input"), "cost_output": cost.get("output")}
    _mark_current(models)
    return {"id": raw["id"], "name": raw.get("name") or raw["id"],
            "base_url": raw.get("api") or _DEFAULT_URLS.get(raw["id"]),
            "doc": raw.get("doc"), "models": models}


def _is_alias(provider_id: str, mid: str, m: dict, listed: dict) -> bool:
    """A moving alias (e.g. "...-latest") for another model this provider also lists."""
    canonical = (m.get("canonical_model_id") or "").removeprefix(f"{provider_id}/")
    return bool(canonical) and canonical != mid and canonical in listed


def _efforts(m: dict) -> list[str] | None:
    """Reasoning effort levels the model takes; "none" leads when thinking can be switched off."""
    options = m.get("reasoning_options") or []
    values = next((list(o.get("values") or []) for o in options if o.get("type") == "effort"), [])
    if any(o.get("type") == "toggle" for o in options) and "none" not in values:
        values.insert(0, "none")
    return values or None


def _mark_current(models: dict) -> None:
    """Current = the newest chat model of each family, released within a year of the provider's newest.

    Release dates are "YYYY-MM-DD" or "YYYY-MM"; both compare as strings, and a year back is the same
    string with the year lowered by one.
    """
    chats = [m for m in models.values() if m["kind"] == "chat"]  # already newest first
    newest = next((m["release_date"] for m in chats if m["release_date"]), None)
    cutoff = f"{int(newest[:4]) - 1}{newest[4:]}" if newest else ""
    seen: set[str] = set()
    for m in models.values():
        family = m["family"] or m["id"]
        m["current"] = m["kind"] == "chat" and family not in seen and (m["release_date"] or "") >= cutoff
        if m["kind"] == "chat":
            seen.add(family)


def _fetch() -> dict:
    res = httpx.get(SOURCE, timeout=8)
    res.raise_for_status()
    return res.json()
