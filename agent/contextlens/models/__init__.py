"""Models by role. Every model call in the backend goes through `chat_model(role)`.

Roles: "agent" answers and uses tools; "memory" keeps memories (defaults to the agent's model);
"embedding" turns text into vectors (defaults to a local model). Each role can be a provider/model
chosen in the settings page.
Models are built the way the Deep Agents docs show for configured models: `init_chat_model` with an
`openai:` spec, pointed at the provider's OpenAI-compatible URL with the user's key.
https://docs.langchain.com/oss/python/deepagents/models
"""
from __future__ import annotations

import time
from collections.abc import Callable

from langchain_core.language_models import BaseChatModel

from langchain_core.embeddings import Embeddings

from . import local_embedding, settings
from .catalog import providers
from .settings import ROLES

__all__ = ["ROLES", "NotConfigured", "chat_model", "embedding_model", "model_list", "overview", "providers", "settings",
           "test", "use"]

# Reasoning has to survive a tool loop, and only the Responses API carries it back in full.
# OpenAI: the documented no-retention setup (store=False, reasoning returned encrypted and replayed).
# DeepSeek: its docs require earlier reasoning to be sent back once tools are involved
# (https://api-docs.deepseek.com/guides/thinking_mode); over /responses it is, over
# /chat/completions it is dropped. Both verified with spikes/reasoning_probe.py (2026-10-28).
_PROVIDER_KWARGS = {
    "openai": {"use_responses_api": True, "store": False, "include": ["reasoning.encrypted_content"]},
    "deepseek": {"use_responses_api": True},
}

_override: Callable[[str], BaseChatModel] | None = None
_embedding_override: tuple[str, Embeddings] | None = None


class NotConfigured(RuntimeError):
    """No usable provider, model or key for a role; the settings page fixes it."""


def chat_model(role: str = "agent") -> BaseChatModel:
    if _override is not None:
        return _override(role)
    spec = role_spec(role)
    if not spec:
        raise NotConfigured(f"No model is set for the {role} role. Choose one in Settings → Models.")
    provider_id, model_id = spec
    levels = efforts(provider_id, model_id) or ()
    # Memory upkeep runs after every turn and holds up the next one: the lightest effort unless set.
    effort = settings.read()["efforts"].get(role) or (levels[0] if role == "memory" and levels else None)
    if effort in levels:
        return _chat(provider_id, model_id, reasoning={"effort": effort})
    return _chat(provider_id, model_id)


def embedding_model(*, local_only: bool = False) -> tuple[str, Embeddings] | None:
    """("provider/model", client) for the embedding role. Nothing to set up: unless a provider's model
    was chosen, it runs on this machine. None when not even that is available."""
    if _override is not None:
        return _embedding_override
    # Scoring the whole field may touch sources the user has not chosen to send.
    if local_only:
        return local_embedding.available()
    spec = role_spec("embedding")
    if spec:
        try:
            return "/".join(spec), _embeddings(*spec)
        except NotConfigured:
            pass
    return local_embedding.available()


def use(factory: Callable[[str], BaseChatModel] | None,
        embedding: tuple[str, Embeddings] | None = None) -> None:
    """Swap the model source, e.g. for tests. Pass None to restore the settings."""
    global _override, _embedding_override
    _override, _embedding_override = factory, embedding


def role_spec(role: str) -> tuple[str, str] | None:
    """(provider id, model id) chosen for a role; memory upkeep follows the agent unless set."""
    roles = settings.read()["roles"]
    spec = roles.get(role) or (roles.get("agent") if role == "memory" else None)
    if not spec:
        return None
    provider_id, model_id = spec.split("/", 1)
    return provider_id, model_id


def efforts(provider_id: str, model_id: str) -> list[str] | None:
    """Effort levels the model takes (from the catalog), or None when it has no setting for it.

    Offered only where calls go through the Responses API, which carries `reasoning.effort`;
    other providers' chat endpoints name it differently, if they take it at all.
    """
    if not _PROVIDER_KWARGS.get(provider_id, {}).get("use_responses_api"):
        return None
    model = providers().get(provider_id, {}).get("models", {}).get(model_id)
    return model.get("efforts") if model else None


def model_list(provider_id: str) -> list[dict] | None:
    """The provider's models, each marked whether the picker shows it: the user's choice, else current."""
    provider = providers().get(provider_id)
    if not provider:
        return None
    chosen = settings.read()["shown"].get(provider_id)
    return [{**m, "efforts": efforts(provider_id, m["id"]),
             "shown": m["id"] in chosen if chosen is not None else m["current"]}
            for m in provider["models"].values()]


def overview() -> dict:
    """What the settings page shows: providers, whether each has a key, and each role's model."""
    rows = []
    for p in providers().values():
        key, base_url = settings.credentials(p)
        rows.append({"id": p["id"], "name": p["name"], "base_url": base_url, "default_base_url": p["base_url"],
                     "doc": p["doc"], "connected": bool(key), "model_count": len(p["models"])})
    rows.sort(key=lambda r: (not r["connected"], r["name"].lower()))
    roles = {}
    for role in ROLES:
        spec = role_spec(role)
        roles[role] = "/".join(spec) if spec else None
    return {"providers": rows, "roles": roles, "efforts": settings.read()["efforts"]}


def test(provider_id: str, model_id: str, kind: str = "chat") -> dict:
    """One tiny real request. Errors are reported by kind and message, with the key masked."""
    key = None
    start = time.perf_counter()
    try:
        _, key, base_url = _resolve(provider_id)
        if kind == "embedding":
            _embeddings(provider_id, model_id, max_retries=0).embed_query("ping")
        else:
            _chat(provider_id, model_id, timeout=30, max_retries=0).invoke("Reply with OK.")
        return {"ok": True, "latency_ms": round((time.perf_counter() - start) * 1000)}
    except Exception as e:  # report every failure; the user needs to see why
        message = str(e).replace(key, "***") if key else str(e)
        return {"ok": False, "error": f"{type(e).__name__}: {message[:300]}"}


def _resolve(provider_id: str) -> tuple[dict, str, str]:
    provider = providers().get(provider_id)
    if not provider:
        raise NotConfigured(f"Unknown provider: {provider_id}")
    key, base_url = settings.credentials(provider)
    if not key:
        raise NotConfigured(f"No API key for {provider['name']}. Add one in Settings → Models.")
    return provider, key, base_url


def _embeddings(provider_id: str, model_id: str, **kwargs):
    from langchain_openai import OpenAIEmbeddings

    _, key, base_url = _resolve(provider_id)
    # Counting tokens with OpenAI's tokenizer first only makes sense for OpenAI's own models.
    return OpenAIEmbeddings(model=model_id, base_url=base_url, api_key=key, timeout=20,
                            check_embedding_ctx_length=provider_id == "openai", **kwargs)


def _chat(provider_id: str, model_id: str, **kwargs) -> BaseChatModel:
    from langchain.chat_models import init_chat_model

    _, key, base_url = _resolve(provider_id)
    return init_chat_model(f"openai:{model_id}", api_key=key, base_url=base_url,
                           **{**_PROVIDER_KWARGS.get(provider_id, {}), **kwargs})
