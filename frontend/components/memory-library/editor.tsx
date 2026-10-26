"use client";
import { useState } from "react";
import type { MemoryRecord, SessionContextMode } from "@/lib/memory-types";
import { CONTEXT_MODES } from "@/lib/memory-validation";

export function MemoryEditor({memory, onSaved, onCancel}: {memory?: MemoryRecord; onSaved: () => void; onCancel: () => void}) {
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [source, setSource] = useState(memory?.source_kind ?? "User supplied");
  const [mode, setMode] = useState<SessionContextMode>(memory?.context_scope ?? "general");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="my-4 grid gap-3 rounded-xl border bg-white p-5" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const res = await fetch("/api/memories", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: memory?.id, revision: memory?.revision, title, content, source_kind: source, context_scope: mode})});
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      onSaved();
    } catch(e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally {setBusy(false);}
  }}>
    <h2 className="font-semibold">{memory ? "Edit memory" : "Add memory"}</h2>
    <label>Title<input required className="block w-full rounded border p-2" value={title} onChange={e => setTitle(e.target.value)}/></label>
    <label>Content<textarea required maxLength={20000} className="block w-full rounded border p-2" value={content} onChange={e => setContent(e.target.value)}/></label>
    <label>Source<input required className="block w-full rounded border p-2" value={source} onChange={e => setSource(e.target.value)}/></label>
    <label>Applies in<select className="ml-3 rounded border p-2" value={mode} onChange={e => setMode(e.target.value as SessionContextMode)}>{CONTEXT_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
    <p className="text-sm text-stone-500">Changes are persistent. An open conversation will require a refreshed preview before sending.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-4"><button disabled={busy} type="submit">{busy ? "Saving…" : "Save memory"}</button><button disabled={busy} type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}
