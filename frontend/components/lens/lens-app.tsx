"use client";

import { useStream } from "@langchain/langgraph-sdk/react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ModelPicker } from "@/components/model-settings/model-picker";
import { SettingsDialog } from "@/components/model-settings/settings-dialog";
import { useModelSettings } from "@/components/model-settings/use-model-settings";
import {
	ASSISTANT_ID,
	apiUrl,
	type Draft,
	previewContext,
} from "@/lib/lens/api";
import { useLensText } from "@/lib/lens/text";
import type {
	CardState,
	Change,
	LensState,
	Snapshot,
	TurnRecord,
} from "@/lib/lens/types";
import { cardState, FIELD_LAYERS, stripMarkers } from "@/lib/lens/types";
import { AnswerCard, type Rewrite } from "./answer-card";
import { ContextMeter, stripItems } from "./context-meter";
import {
	type DropTarget,
	FieldEngine,
	type FieldModel,
	type Rect,
} from "./field-engine";
import { Inbox } from "./inbox";
import { ScopeBar } from "./scope-bar";
import { SettingsMenu } from "./settings-menu";
import { SituationSettings } from "./situation-settings";
import { useOverview } from "./use-overview";
import { useScope } from "./use-scope";

const THREADS_KEY = "contextlens.threads";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readThreads(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(THREADS_KEY) ?? "{}");
	} catch {
		return {};
	}
}

/** Each scope's last conversation, if one was saved and looks valid. */
function readThread(scope: string): string | null {
	const id = readThreads()[scope];
	return id && UUID.test(id) ? id : null;
}

function rememberThread(scope: string, id: string | null) {
	try {
		const threads = readThreads();
		if (id) threads[scope] = id;
		else delete threads[scope];
		localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
	} catch {
		/* storage unavailable */
	}
}

const EMPTY: Draft = { excluded: [], pinned: [] };
const without = (xs: string[], id: string) => xs.filter((x) => x !== id);

type View =
	| { kind: "draft"; snapshot: Snapshot | null }
	| { kind: "turn"; turn: number; record: TurnRecord };

const plain = (content: unknown) =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.map((p) =>
						typeof p === "string" ? p : ((p as { text?: string }).text ?? ""),
					)
					.join("")
			: "";

export function LensApp() {
	const text = useLensText();
	const { t } = text;
	const locale = useLocale();
	const examples = t.raw("lens.examples") as string[];
	const { scope, chooseScope, projectId } = useScope();
	const overview = useOverview(scope);
	const [threadId, setThreadId] = useState<string | null>(null);
	const stream = useStream<LensState>({
		apiUrl: apiUrl(),
		assistantId: ASSISTANT_ID,
		threadId,
		messagesKey: "messages",
		onThreadId: (id) => {
			setThreadId(id || null);
			if (id) rememberThread(scope, id);
		},
	});
	const switchThread = useRef(stream.switchThread);
	switchThread.current = stream.switchThread;
	useEffect(() => {
		// Each scope has its own conversation; resume it only if the agent still has it (it forgets
		// on restart).
		let live = true;
		const saved = readThread(scope);
		switchThread.current(null);
		setThreadId(null);
		if (saved)
			fetch(`/api/threads/${saved}`)
				.then((res) => {
					if (!live) return;
					if (res.ok) setThreadId(saved);
					else rememberThread(scope, null);
				})
				.catch(() => rememberThread(scope, null));
		return () => {
			live = false;
		};
	}, [scope]);

	const [input, setInput] = useState("");
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [preview, setPreview] = useState<Snapshot | null>(null);
	const [previewNonce, setPreviewNonce] = useState(0);
	const [regenTurn, setRegenTurn] = useState<number | null>(null);
	const [shelfOpen, setShelfOpen] = useState(false);
	const [placed, setPlaced] = useState(0);
	const modelSettings = useModelSettings();
	const [managingModels, setManagingModels] = useState(false);
	const [managingSituations, setManagingSituations] = useState(false);
	const [toastMsg, setToastMsg] = useState<string | null>(null);
	const [stripRemovals, setStripRemovals] = useState(0);

	const records = useMemo<Record<string, TurnRecord>>(
		() => stream.values?.turn_records ?? {},
		[stream.values],
	);
	const turns = useMemo(() => {
		const out: Array<{ q: string; a: string | null }> = [];
		for (const m of stream.messages) {
			if (m.type === "human") out.push({ q: plain(m.content), a: null });
			else if (m.type === "ai" && out.length && out[out.length - 1].a === null)
				out[out.length - 1].a = plain(m.content);
		}
		return out;
	}, [stream.messages]);
	const composing =
		input.trim() !== "" ||
		draft.pinned.length > 0 ||
		draft.excluded.length > 0 ||
		turns.length === 0;

	const reloadOverview = overview.reload;
	useEffect(() => {
		if (stream.isLoading) return;
		setRegenTurn(null);
		// A finished turn may have proposed a scene, or named new concepts.
		reloadOverview();
	}, [stream.isLoading, reloadOverview]);

	// Ask the agent what the next request would carry; never calls a model.
	const valuesRef = useRef(stream.values);
	valuesRef.current = stream.values;
	const messageCount = stream.values?.messages?.length ?? 0;
	// messageCount and previewNonce are triggers: a new turn or a rule change alters the preview.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		let live = true;
		const t = setTimeout(() => {
			previewContext(valuesRef.current, input.trim(), projectId, draft)
				.then((s) => {
					if (live) setPreview(s);
				})
				.catch(() => {
					/* keep the last preview; the agent may still be starting */
				});
		}, 220);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [input, projectId, draft, messageCount, previewNonce]);

	// The input grows with what is typed, up to its CSS max-height, then scrolls.
	// biome-ignore lint/correctness/useExhaustiveDependencies: input is the trigger; the size is read from the DOM
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [input]);

	const toast = useCallback((m: string) => {
		setToastMsg(m);
		setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 2400);
	}, []);

	// ---------- refs the field engine reads every frame ----------
	const stageRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const trayRef = useRef<HTMLDivElement>(null);
	const sheetRef = useRef<HTMLElement>(null);
	const msgsRef = useRef<HTMLDivElement>(null);
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const noteRef = useRef<HTMLDivElement>(null);
	const shelfRef = useRef<HTMLButtonElement>(null);
	const toolsRef = useRef<HTMLDivElement>(null);
	const engineRef = useRef<FieldEngine | null>(null);
	const viewRef = useRef<View>({ kind: "draft", snapshot: null });
	const sticky = useRef<string[] | null>(null);

	const ctx = useRef({
		composing,
		preview,
		records,
		draft,
		text,
		shelfOpen,
	});
	ctx.current = { composing, preview, records, draft, text, shelfOpen };

	const viewTurn = useCallback((): number | null => {
		const msgs = msgsRef.current;
		if (!msgs) return null;
		const box = msgs.getBoundingClientRect();
		const mid = box.top + box.height * 0.45;
		let best: number | null = null;
		let bd = Infinity;
		msgs.querySelectorAll<HTMLElement>("[data-turn]").forEach((el) => {
			const r = el.getBoundingClientRect();
			const d = r.top > mid ? r.top - mid : r.bottom < mid ? mid - r.bottom : 0;
			if (d < bd) {
				bd = d;
				best = Number(el.dataset.turn);
			}
		});
		return best;
	}, []);

	const model = useCallback((): FieldModel => {
		const stage = stageRef.current!;
		const sb = stage.getBoundingClientRect();
		const rel = (el: Element | null | undefined): Rect | null => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				x: r.left - sb.left,
				y: r.top - sb.top,
				w: r.width,
				h: r.height,
			};
		};
		const sheet = rel(sheetRef.current) ?? { x: 0, y: 0, w: 0, h: 0 };
		const form = rel(formRef.current) ?? { x: 0, y: 0, w: 0, h: 0 };
		const {
			composing: drafting,
			preview: snap,
			records: recs,
			text: tx,
		} = ctx.current;
		const vt = drafting ? null : viewTurn();
		const rec = vt !== null ? recs[String(vt)] : undefined;
		const view: View =
			rec && vt !== null
				? { kind: "turn", turn: vt, record: rec }
				: { kind: "draft", snapshot: snap };
		viewRef.current = view;
		const v =
			view.kind === "turn"
				? view.record.versions[view.record.versions.length - 1]
				: null;
		const candidates = v
			? v.candidates
			: view.kind === "draft"
				? (view.snapshot?.candidates ?? [])
				: [];
		const selected = v
			? v.selected_ids
			: view.kind === "draft"
				? (view.snapshot?.selected_ids ?? [])
				: [];
		const visible = candidates.filter(
			(c) => FIELD_LAYERS.includes(c.layer) && c.status !== "trashed",
		);
		const state: Record<string, CardState> = {};
		visible.forEach((c) => {
			state[c.id] = cardState(c, selected);
		});

		const anchors: FieldModel["anchors"] = {};
		let answer: Rect | null = null;
		if (view.kind === "draft") {
			formRef.current
				?.querySelectorAll<HTMLElement>("[data-sid]")
				.forEach((e) => {
					const id = e.dataset.sid!;
					if (state[id] !== "in") return;
					const r = rel(e)!;
					anchors[id] = { x: r.x + r.w / 2, y: r.y, kind: "strip" };
				});
		} else {
			const el = msgsRef.current?.querySelector<HTMLElement>(
				`[data-turn="${view.turn}"]`,
			);
			const mr = rel(msgsRef.current)!;
			const lo = mr.y + 6;
			const hi = mr.y + mr.h - 6;
			const place = (id: string, y: number) => {
				if (anchors[id] || state[id] !== "in") return;
				anchors[id] = {
					x: sheet.x + sheet.w,
					y: Math.max(lo, Math.min(hi, y)),
					kind: "text",
					fade: y < lo || y > hi,
				};
			};
			if (el) {
				answer = rel(el);
				if (el.classList.contains("flipped"))
					for (const e of el.querySelectorAll<HTMLElement>("[data-iid]"))
						place(e.dataset.iid!, rel(e)!.y + 14);
				else
					el.querySelectorAll<HTMLElement>(".seg[data-src]").forEach((e) => {
						const y = rel(e)!.y + 12;
						e.dataset
							.src!.split(" ")
							.filter(Boolean)
							.forEach((id) => {
								place(id, y);
							});
					});
				if (answer)
					for (const id of Object.keys(state))
						place(id, answer.y + answer.h / 2);
			}
		}
		const label =
			view.kind === "turn"
				? tx.t("lens.noteTurn", { n: view.turn + 1 })
				: tx.t("lens.noteNext");
		if (noteRef.current && noteRef.current.textContent !== label)
			noteRef.current.textContent = label;
		if (toolsRef.current)
			toolsRef.current.style.left = `${sheet.x + sheet.w + 48}px`;
		const shelved = Object.values(state).filter((s) => s === "idle").length;
		const shelfLabel = `${tx.t("lens.shelf", { count: shelved })} · ${tx.t(
			ctx.current.shelfOpen ? "lens.shelfClose" : "lens.shelfOpen",
		)}`;
		if (shelfRef.current && shelfRef.current.textContent !== shelfLabel)
			shelfRef.current.textContent = shelfLabel;

		const scopeLabel = (c: (typeof visible)[number]) =>
			c.layer === "short_term"
				? tx.t("items.scopeChat")
				: c.layer === "retrieval"
					? ""
					: (c.scenes ?? []).join(" · ");
		return {
			cards: visible.map((c) => {
				const title = tx.title(c);
				return {
					id: c.id,
					layer: c.layer,
					title,
					content: c.content,
					stale: !!c.stale,
					scope: scopeLabel(c),
					kind: tx.layer(c.layer),
					unlink: tx.t("lens.unlink", { title }),
					meta: [
						c.layer === "short_term" ? "" : c.source_label,
						c.stale ? tx.t("items.maybeStale") : "",
					]
						.filter(Boolean)
						.join(" · "),
				};
			}),
			state,
			pinned: new Set(v ? v.pinned : ctx.current.draft.pinned),
			anchors,
			sheet,
			form,
			answer,
			floor: (() => {
				const t = rel(toolsRef.current);
				return t ? t.y + t.h : sheet.y + sheet.h;
			})(),
			shelf: ctx.current.shelfOpen,
		};
	}, [viewTurn]);

	// ---------- focus (depth of field) ----------
	const focus = useCallback((ids: string[] | null, turn?: number) => {
		engineRef.current?.highlight(ids);
		const root = stageRef.current;
		if (!root) return;
		root.querySelectorAll(".seg.hl, .sg.hl, .item.hl").forEach((e) => {
			e.classList.remove("hl");
		});
		if (!ids) return;
		const view = viewRef.current;
		const t = turn ?? (view.kind === "turn" ? view.turn : null);
		const el = t !== null ? root.querySelector(`[data-turn="${t}"]`) : null;
		el?.querySelectorAll<HTMLElement>(".seg[data-src]").forEach((s) => {
			if (s.dataset.src!.split(" ").some((id) => ids.includes(id)))
				s.classList.add("hl");
		});
		root
			.querySelectorAll<HTMLElement>("[data-sid], [data-iid]")
			.forEach((s) => {
				if (ids.includes(s.dataset.sid ?? s.dataset.iid ?? ""))
					s.classList.add("hl");
			});
	}, []);
	const hover = useCallback(
		(ids: string[] | null, turn?: number) => {
			if (!sticky.current) focus(ids, turn);
		},
		[focus],
	);
	const pin = useCallback(
		(ids: string[] | null, turn?: number) => {
			sticky.current = ids;
			focus(ids, turn);
		},
		[focus],
	);

	// ---------- changes ----------
	const submitRegen = useCallback(
		(turn: number, req: Record<string, unknown>) => {
			setRegenTurn(turn);
			stream.submit({
				regen_request: { turn, ...req },
				locale,
			} as Partial<LensState>);
		},
		[stream, locale],
	);

	const rewrite = useCallback(
		async (turn: number, change: Rewrite) => {
			try {
				submitRegen(turn, { ...change });
			} catch (e) {
				toast(t("toast.rewriteFailed"));
			}
		},
		[submitRegen, toast, t],
	);

	const changeView = useCallback(
		(note: Change, fn: (d: Draft) => Draft) => {
			const view = viewRef.current;
			if (stream.isLoading) {
				toast(t("toast.waitForAnswer"));
				return;
			}
			if (view.kind === "draft") {
				setDraft((d) => fn(d));
				setPreviewNonce((n) => n + 1);
				return;
			}
			const v = view.record.versions[view.record.versions.length - 1];
			const next = fn({ excluded: v.excluded, pinned: v.pinned });
			void rewrite(view.turn, { ...next, note: [note] });
		},
		[rewrite, stream.isLoading, toast, t],
	);

	const titleOf = useCallback(
		(id: string) => {
			const view = viewRef.current;
			const list =
				view.kind === "turn"
					? view.record.versions[view.record.versions.length - 1].candidates
					: (view.snapshot?.candidates ?? []);
			const c = list.find((x) => x.id === id);
			return c ? text.title(c) : id;
		},
		[text],
	);
	const exclude = useCallback(
		(id: string, op: Change["op"] = "exclude") =>
			changeView({ op, id }, (d) => ({
				excluded: [...without(d.excluded, id), id],
				pinned: without(d.pinned, id),
			})),
		[changeView],
	);

	const onDrop = useCallback(
		(id: string, target: DropTarget, s: CardState) => {
			const view = viewRef.current;
			if (target === "composer") {
				setDraft((d) => ({
					excluded: without(d.excluded, id),
					pinned: [...without(d.pinned, id), id],
				}));
				toast(t("toast.pinnedNext", { title: titleOf(id) }));
				return;
			}
			if (target === "answer" && view.kind === "turn") {
				changeView({ op: "pin", id }, (d) => ({
					excluded: without(d.excluded, id),
					pinned: [...without(d.pinned, id), id],
				}));
				return;
			}
			if ((target === "tray" || target === "fling") && s !== "ex") {
				exclude(id, target === "fling" ? "remove" : "exclude");
				return;
			}
			if (target === "none" && s === "ex")
				changeView({ op: "restore", id }, (d) => ({
					...d,
					excluded: without(d.excluded, id),
				}));
		},
		[changeView, exclude, titleOf, toast, t],
	);

	const noSource = t("toast.noSource");
	const handlers = useRef({ model, onDrop, exclude, hover, pin, noSource });
	handlers.current = { model, onDrop, exclude, hover, pin, noSource };

	useEffect(() => {
		const engine = new FieldEngine(
			stageRef.current!,
			svgRef.current!,
			{
				tray: trayRef.current!,
				shelf: shelfRef.current!,
			},
			{
				model: () => handlers.current.model(),
				onDrop: (id, target, s) => handlers.current.onDrop(id, target, s),
				onUnlink: (id) => handlers.current.exclude(id, "unlink"),
				onHover: (id) => handlers.current.hover(id ? [id] : null),
				onClick: (id) => handlers.current.pin([id]),
				onPlaced: setPlaced,
			},
		);
		engineRef.current = engine;
		engine.start();
		return () => engine.destroy();
	}, []);

	// ---------- sentence hover and click ----------
	useEffect(() => {
		const msgs = msgsRef.current!;
		const segOf = (e: Event) =>
			(e.target as HTMLElement).closest<HTMLElement>(".seg[data-src]");
		const turnOf = (el: HTMLElement) =>
			Number(el.closest<HTMLElement>("[data-turn]")?.dataset.turn);
		const over = (e: Event) => {
			const s = segOf(e);
			if (!s || sticky.current) return;
			const ids = s.dataset.src!.split(" ").filter(Boolean);
			handlers.current.hover(ids, turnOf(s));
			s.classList.add("hl");
		};
		const out = (e: Event) => {
			if (segOf(e) && !sticky.current) handlers.current.hover(null);
		};
		const click = (e: Event) => {
			const s = segOf(e);
			if (!s) return;
			const ids = s.dataset.src!.split(" ").filter(Boolean);
			if (sticky.current && s.classList.contains("hl")) {
				handlers.current.pin(null);
				return;
			}
			handlers.current.pin(ids, turnOf(s));
			s.classList.add("hl");
			if (!ids.length) toast(handlers.current.noSource);
		};
		const away = (e: Event) => {
			const t = e.target as HTMLElement;
			if (
				sticky.current &&
				!t.closest(".seg") &&
				!t.closest(".warn") &&
				!t.closest(".lens-card")
			)
				handlers.current.pin(null);
		};
		msgs.addEventListener("mouseover", over);
		msgs.addEventListener("mouseout", out);
		msgs.addEventListener("click", click);
		document.addEventListener("pointerdown", away);
		return () => {
			msgs.removeEventListener("mouseover", over);
			msgs.removeEventListener("mouseout", out);
			msgs.removeEventListener("click", click);
			document.removeEventListener("pointerdown", away);
		};
	}, [toast]);

	// ---------- send ----------
	const send = (e: React.FormEvent) => {
		e.preventDefault();
		const q = input.trim();
		if (!q || stream.isLoading) return;
		stream.submit(
			{
				messages: [{ type: "human", content: q }],
				project_id: projectId,
				context_policies: draft.excluded.map((id) => ({
					item_id: id,
					status: "temporarily_ignored",
				})),
				manual_memory_ids: draft.pinned,
				regen_request: null,
				locale,
			} as Partial<LensState>,
			{
				optimisticValues: (prev) => ({
					...prev,
					messages: [
						...(prev.messages ?? []),
						{ type: "human", content: q, id: `pending-${Date.now()}` },
					],
				}),
			},
		);
		setInput("");
		setDraft(EMPTY);
		requestAnimationFrame(() => {
			msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
		});
	};

	const usage = useCallback(
		(id: string) =>
			Object.values(records).filter((r) =>
				r.versions[r.versions.length - 1]?.selected_ids.includes(id),
			).length,
		[records],
	);

	const items = preview
		? stripItems(preview.candidates, preview.selected_ids, input.trim(), text)
		: stripItems([], [], input.trim(), text);
	const composingNext = Boolean(
		composing && (input.trim() || draft.pinned.length),
	);
	const pending = turns.length > 0 && stream.isLoading && regenTurn === null;

	return (
		<div
			className="lens-root"
			ref={stageRef}
			style={
				{
					// Badge text drawn by CSS (::after) on cards the engine renders.
					"--t-pinned": JSON.stringify(t("lens.badgePinned")),
					"--t-near": JSON.stringify(t("lens.nearMiss")),
				} as React.CSSProperties
			}
		>
			<svg className="wires" ref={svgRef} aria-hidden="true" />
			<div className="lens-zone" ref={trayRef}>
				<span>{t("lens.zoneTray")}</span>
			</div>
			<button
				type="button"
				className="lens-shelf"
				ref={shelfRef}
				hidden
				aria-expanded={shelfOpen}
				onClick={() => setShelfOpen((o) => !o)}
			/>

			<section
				className="lens-sheet"
				ref={sheetRef}
				aria-label={t("lens.conversation")}
			>
				<div className="lens-head">
					<div className="lens-head-row">
						<div className="lens-mark">
							<BrandLogo />
						</div>
						{overview.data && (
							<ScopeBar
								projects={overview.data.projects}
								scope={scope}
								onScope={(next) => {
									chooseScope(next);
									setDraft(EMPTY);
								}}
								onChanged={overview.reload}
							/>
						)}
						<nav
							className="lens-head-actions"
							aria-label={t("lens.navigation")}
						>
							<Link href="/memories" className="lens-text-btn">
								{t("lens.library")}
							</Link>
							<button
								type="button"
								className="lens-text-btn"
								onClick={() => {
									rememberThread(scope, null);
									setThreadId(null);
									stream.switchThread(null);
									setDraft(EMPTY);
								}}
							>
								{t("lens.newChat")}
							</button>
							<SettingsMenu
								onManageModels={() => setManagingModels(true)}
								onManageSituations={() => setManagingSituations(true)}
							/>
						</nav>
					</div>
				</div>
				{overview.data && (
					<Inbox overview={overview.data} onChanged={overview.reload} />
				)}
				<div className="lens-msgs" ref={msgsRef}>
					{turns.length === 0 && (
						<div className="lens-empty">
							<b>{t("lens.emptyTitle")}</b>
							<span>{t("lens.emptyBody")}</span>
							<div className="lens-chips">
								{examples.map((q) => (
									<button
										key={q}
										type="button"
										className="lens-chip"
										onClick={() => {
											setInput(q);
											inputRef.current?.focus();
										}}
									>
										{q}
									</button>
								))}
							</div>
						</div>
					)}
					{turns.map((t, i) => {
						const rec = records[String(i)];
						const streaming = !rec
							? t.a !== null
								? stripMarkers(t.a)
								: pending && i === turns.length - 1
									? ""
									: null
							: null;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a turn is identified by its position
							<div key={i} style={{ display: "contents" }}>
								<div className="lens-q">{t.q}</div>
								{(rec || streaming !== null) && (
									<AnswerCard
										index={i}
										record={rec}
										streamingText={streaming}
										busy={regenTurn === i}
										usage={usage}
										onRewrite={(turn, change) => void rewrite(turn, change)}
										onUndo={(turn) => submitRegen(turn, { action: "undo" })}
										onHover={(ids, turn) => hover(ids, turn)}
										onFlip={() => pin(null)}
										onStale={(ids, turn) => pin(ids, turn)}
										threadId={threadId}
										onMemoryChanged={() => setPreviewNonce((n) => n + 1)}
										scenes={overview.data?.scenes ?? []}
										concepts={overview.data?.concepts ?? []}
									/>
								)}
							</div>
						);
					})}
					{stream.error ? (
						<div className="lens-error">
							{t("lens.error", {
								message: String(
									(stream.error as Error)?.message ?? stream.error,
								),
							})}
						</div>
					) : null}
				</div>
				<form className="lens-composer" ref={formRef} onSubmit={send}>
					{/* The line under the bar teaches it once; after that it only speaks while you type. */}
					<ContextMeter
						items={items}
						details={composingNext || turns.length === 0}
						idleHint={turns.length === 0 ? t("lens.stripIdle") : undefined}
						pressed={stripRemovals}
						onRemove={(id) => {
							setStripRemovals((n) => n + 1);
							setDraft((d) => ({
								excluded: [...without(d.excluded, id), id],
								pinned: without(d.pinned, id),
							}));
							toast(
								t("toast.removedNext", {
									title: items.find((i) => i.id === id)?.label ?? id,
								}),
							);
						}}
						onHover={hover}
					/>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a larger target for the textarea, which keeps its own keyboard access */}
					<div
						className="lens-row"
						onClick={(e) => {
							if (e.target === e.currentTarget) inputRef.current?.focus();
						}}
					>
						<textarea
							id="lens-q"
							ref={inputRef}
							rows={1}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								// Enter also confirms an IME composition; that must not send.
								if (
									e.key === "Enter" &&
									!e.shiftKey &&
									!e.nativeEvent.isComposing
								) {
									e.preventDefault();
									formRef.current?.requestSubmit();
								}
							}}
							autoComplete="off"
							placeholder={t("lens.placeholder")}
							aria-label={t("lens.inputLabel")}
						/>
						<div className="lens-row-tools">
							<ModelPicker
								settings={modelSettings}
								onManage={() => setManagingModels(true)}
							/>
							<button
								className="lens-send"
								type="submit"
								disabled={!input.trim() || stream.isLoading}
								aria-label={t("lens.send")}
								title={t("lens.send")}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
								</svg>
							</button>
						</div>
					</div>
				</form>
			</section>

			{/* Which request the field shows, and its tools; only what is needed right now shows. */}
			<div className="lens-fieldbar" ref={toolsRef}>
				<div className="lens-field-note" ref={noteRef} />
				{placed > 0 && (
					<button
						type="button"
						className="lens-text-btn lens-float"
						onClick={() => engineRef.current?.tidy()}
					>
						{t("lens.tidy", { count: placed })}
					</button>
				)}
			</div>
			{managingSituations && (
				<SituationSettings
					current={overview.data?.scenes ?? []}
					onClose={() => setManagingSituations(false)}
					onSaved={overview.reload}
				/>
			)}
			<SettingsDialog
				open={managingModels}
				onOpenChange={setManagingModels}
				settings={modelSettings}
			/>
			<div
				className={"lens-toast" + (toastMsg ? " on" : "")}
				role="status"
				aria-live="polite"
			>
				{toastMsg}
			</div>
		</div>
	);
}
