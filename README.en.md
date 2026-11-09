# ContextLens

English · [中文](README.md)

See what the model actually sees. ContextLens is a general-purpose agent with long-term memory that makes the context and memories behind every turn visible, editable and traceable.

## The interface

- **Viewfinder**: the segmented bar above the input is the complete context of the next request, each segment as wide as its token count. It updates as you type and says why each item is in; memories and files can be dragged into or out of the turn.
- **Memory field**: the canvas holds the memories, project files and earlier conversations available to the turn, laid out by how relevant they are to the question.
- **Sentence-level sources**: every sentence of an answer names what it rests on, and a wire links each card to its sentence. Hover a sentence to bring its sources into focus while the rest blur.
- **Situation**: before answering, each turn reads the moment: which scene it belongs to, what you are doing, which people and things come up. The reading appears under the answer. Correct it, or brighten or dim a concept, and the answer is rewritten on the spot.
- **Step cards**: open the steps a turn actually ran to see each tool call's input and output and the context sent to the model. A turn can be rewritten many times and taken back to the previous version.
- **Memory library**: browse and edit every memory, see each one's version history and a timeline of all changes with before-and-after views, and undo any change. Paste what another assistant or your own notes know about you, pick what to keep, and import it in one batch.
- **Projects**: a project links local folders and has its own instructions and conversations. Projects are isolated by default; a shared project also draws on the memories of ordinary conversations.

## How memory works

- **Situation**: a situation has three parts: the scene (Work, Study and Life by default, each with a definition you can edit, or generate from a description of how you work), what you are doing, and the people and things named. When several turns in a row fit no scene, a new one is proposed and takes effect once you agree.
- **Recall**: memories come to mind on three things: whether they involve the same people and things, whether what you were doing when they were written is close to what you are doing now, and whether their content matches; a shared scene tips the balance. Content is matched by words and by meaning, so a question in Chinese finds a memory written in English. A few always-on memories come along every turn.
- **Writing**: after each answer, new memories are drawn from the turn; corrections and facts that no longer hold are recognised, and the old memory is marked as superseded.
- **Upkeep**: in the background, different names for the same thing are merged and outdated memories replaced; when evidence conflicts and does not settle the matter, the user is asked, in the inbox.
- **Ledger**: every change goes into an append-only event ledger that records who made it, why, and the sentence it came from, and each one can be undone.

## The agent and its context

- **Snapshot**: each turn's request is assembled as a context snapshot: system prompt, project instructions, conversation history, memories and files, each with the reason it was chosen, under one fingerprint. Assembly is separate from the agent's run, and the snapshot is stored with the turn.
- **Tools**: the agent has three kinds: memory tools (read the situation, recall, remember, revise, forget, link concepts, propose a scene), search across earlier conversations, and read-only file tools over the project's folders (`ls`, `glob`, `grep`, `read_file`). Whatever a tool finds becomes a source the answer can cite and appears on the canvas.
- **Project files**: a chosen file goes into the request whole; one over 20k tokens is left to the agent to read as needed with its file tools. PDF and Word files are searched by content, other files come up by name.
- **Retrieval**: earlier conversations and PDF and Word documents are split at sentence boundaries (LlamaIndex) and searched by BM25 (SQLite FTS5 with jieba segmentation) and local vectors together, fused by RRF. Folders are indexed in the background, incrementally: when linked, when files change (watched), and when the backend starts. Vectors are computed on your machine.

## Quick start

Requires Node.js 22+ and [uv](https://docs.astral.sh/uv/).

```bash
npm install
npm run setup
```

`setup` installs both halves and downloads the embedding model `Qwen3-Embedding-0.6B` (about 2.4 GB; about 2 GB of memory while running, computed entirely on your machine). Under "Add or manage models → Advanced" you can use a provider's embedding model instead, in which case the searched content is sent to that provider.

Put this in `frontend/.env.local`:

```bash
LANGGRAPH_API_URL=http://localhost:2026
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=context_agent
```

Then:

```bash
npm run dev        # your own memories: agent/data/contextlens.sqlite3
npm run dev:demo   # a separate demo database: agent/data/lens-demo-memories.sqlite3
```

Open [http://localhost:3001](http://localhost:3001) and click **Connect a model** beside the input to choose a provider (DeepSeek, OpenAI, Kimi, Qwen, Zhipu and others, listed from [models.dev](https://models.dev) and called through OpenAI-compatible APIs). The same dialog switches models, sets reasoning effort and opens provider settings. Keys are stored only on your machine, in `~/.contextlens/settings.json` (readable by you alone), and never sent back to the browser.

Both servers listen on localhost only; set `LANGGRAPH_PORT` and `FRONTEND_PORT` to change their ports.

## Layout

Backend dependencies point inward only: `graph`, `api` → `engine`, `context`, `provenance` → `records` → `memory` → `models` → `config`.

| Path | Role |
|---|---|
| `agent/contextlens/graph.py` | The app graph: a turn assembles a snapshot → the engine answers → a version is recorded → memories are written; any turn can be rewritten or taken back |
| `agent/contextlens/engine.py` | The engine: [Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) runs the model and tool loop, and only this module imports it; subagents and automatic summaries are off, so context consists of the snapshot and tool results |
| `agent/contextlens/context/` | Snapshot assembly: memories, files and history, each with its reason, rendered into a prompt with a fingerprint |
| `agent/contextlens/provenance/` | Sentence-level sources: short ids for every item, and answers parsed into sentences with their sources |
| `agent/contextlens/memory/` | The memory system: memories and concepts, the event ledger, situation reading, recall, per-turn writing, upkeep, import, memory tools |
| `agent/contextlens/history.py` | Search across earlier conversations and the `search_history` tool |
| `agent/contextlens/project_files/` | Project folders: linking, background indexing and watching, retrieval, the agent's read-only file system, thumbnails |
| `agent/contextlens/hybrid.py`, `passages.py` | Splitting and hybrid retrieval (words and vectors, fused by RRF), shared by history and project files |
| `agent/contextlens/conversations.py`, `projects.py` | The conversation list and project settings |
| `agent/contextlens/models/` | Model catalog (cached from models.dev), local settings and keys, models by role, the local embedding model |
| `agent/contextlens/api.py` | The `/lens/*` endpoints: the per-keystroke preview (no chat model call), settings, memory library, projects, conversations, import; direct requests from browsers are refused |
| `frontend/components/lens/` | Memory field, viewfinder, answers and step cards, situation, inbox |
| `frontend/components/memory-library/` | Memory library: list, version history, change timeline, import |
| `frontend/components/projects/` | Project pages, folder browsing, conversation list |
| `frontend/components/model-settings/` | Model picker and provider settings |
| `frontend/proxy.ts`, `frontend/app/api/` | Same-origin requests only; the proxy passes only the endpoints the interface uses |
| `frontend/messages/`, `frontend/i18n/` | Chinese and English copy (next-intl) |

## Tests and data

```bash
npm run test:agent
```

The repository holds only explicitly fictional data: the people, files and conversations in tests and examples are invented. Personal information, real memories, conversations, keys and runtime databases stay on your machine.

Dependency versions are locked in `agent/uv.lock`, resolving only releases at least two weeks old (`exclude-newer` in `agent/pyproject.toml`).
