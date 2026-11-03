"""The user's model choices and keys, saved per user outside the repository with owner-only access.

This file is the only source of keys and model choices; environment variables are not read. Keys
never leave this module except to build a client; the public view says only whether one is saved.
"""
from __future__ import annotations

import json
import os

from contextlens import config

ROLES = ("agent", "memory", "embedding")
LANGUAGES = ("zh", "en")
# "follow" writes memories in the interface language last seen.
_LANGUAGE = {"choice": "follow", "interface": "zh"}


def _path():
    return config.home() / "settings.json"


def read() -> dict:
    path = _path()
    data = json.loads(path.read_text()) if path.exists() else {}
    return {"providers": data.get("providers", {}), "roles": data.get("roles", {}),
            "efforts": data.get("efforts", {}), "shown": data.get("shown", {}),
            "memory_language": {**_LANGUAGE, **data.get("memory_language", {})}}


def write(data: dict) -> None:
    path = _path()
    config.ensure_home()
    # Create with 0600 before any secret is written, so the key is never briefly world-readable.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(path, 0o600)


def save_provider(provider_id: str, api_key: str | None = None, base_url: str | None = None) -> None:
    data = read()
    entry = data["providers"].setdefault(provider_id, {})
    if api_key:
        entry["api_key"] = api_key.strip()
    if base_url is not None:
        entry["base_url"] = base_url.strip() or None
    write(data)


def forget_provider(provider_id: str) -> None:
    data = read()
    data["providers"].pop(provider_id, None)
    data["shown"].pop(provider_id, None)
    data["roles"] = {r: spec for r, spec in data["roles"].items() if not spec.startswith(f"{provider_id}/")}
    write(data)


def set_roles(roles: dict[str, str | None]) -> None:
    data = read()
    for role, spec in roles.items():
        if role not in ROLES:
            raise ValueError(f"Unknown role: {role}")
        if spec:
            data["roles"][role] = spec
        else:
            data["roles"].pop(role, None)
    write(data)


def set_efforts(efforts: dict[str, str | None]) -> None:
    """Reasoning effort per role. Kept across model switches; applied only where the model takes it."""
    data = read()
    for role, effort in efforts.items():
        if role not in ROLES:
            raise ValueError(f"Unknown role: {role}")
        if effort:
            data["efforts"][role] = effort
        else:
            data["efforts"].pop(role, None)
    write(data)


def set_shown(provider_id: str, model_ids: list[str] | None) -> None:
    """The models a provider offers in the picker; None goes back to the catalog's current ones."""
    data = read()
    if model_ids is None:
        data["shown"].pop(provider_id, None)
    else:
        data["shown"][provider_id] = list(dict.fromkeys(model_ids))
    write(data)


def set_memory_language(choice: str | None = None, interface: str | None = None) -> None:
    data = read()
    if choice is not None and choice not in ("follow", *LANGUAGES):
        raise ValueError(f"Unknown memory language: {choice}")
    if interface is not None and interface not in LANGUAGES:
        raise ValueError(f"Unknown interface language: {interface}")
    saved = data["memory_language"]
    changed = {**saved, **{k: v for k, v in (("choice", choice), ("interface", interface)) if v is not None}}
    if changed != saved:
        write({**data, "memory_language": changed})


def credentials(provider: dict) -> tuple[str | None, str | None]:
    """(saved api key or None, base url)."""
    saved = read()["providers"].get(provider["id"], {})
    return saved.get("api_key"), saved.get("base_url") or provider["base_url"]
