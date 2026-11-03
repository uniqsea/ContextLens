"""Process-wide settings: environment, file locations, tracing policy."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = AGENT_DIR.parent
SHARED_DIR = REPO_DIR / "shared"

load_dotenv(AGENT_DIR / ".env")

# Request evidence stays local unless tracing is explicitly opted into.
if os.environ.get("CONTEXTLENS_ALLOW_TRACING") != "1":
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    os.environ["LANGSMITH_TRACING"] = "false"


def home() -> Path:
    """Per-user settings outside the repository (model keys live here, never in git)."""
    return Path(os.environ.get("CONTEXTLENS_HOME", Path.home() / ".contextlens")).resolve()


def ensure_home() -> Path:
    """Create the settings directory readable by its owner only."""
    path = home()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def db_path() -> Path:
    return Path(os.environ.get("CONTEXTLENS_DB_PATH", AGENT_DIR / "data" / "contextlens.sqlite3")).resolve()


def seed_path() -> Path:
    return Path(os.environ.get("CONTEXTLENS_SEED_PATH", SHARED_DIR / "memory-seeds.json")).resolve()
