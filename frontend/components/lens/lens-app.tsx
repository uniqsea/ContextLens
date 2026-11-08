"use client";

import { useStream } from "@langchain/langgraph-sdk/react";
import { Library, Maximize, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ModelPicker } from "@/components/model-settings/model-picker";
import { SettingsDialog } from "@/components/model-settings/settings-dialog";
import { useModelSettings } from "@/components/model-settings/use-model-settings";
import { PageLoading } from "@/components/page-status";
import { Button } from "@/components/ui/button";
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
import { ORDINARY, projectPath } from "@/lib/projects/types";
import { AnswerCard, type Rewrite } from "./answer-card";
import { ContextField, callable, OrderedInput } from "./context-field";
import { ContextMeter, stripItems } from "./context-meter";
import { ConversationTitle } from "./conversation-title";
import {
	type DropTarget,
	FieldEngine,
	type FieldModel,
	type Rect,
} from "./field-engine";
import { Inbox } from "./inbox";
import { useHistoryLoading, useSessions } from "./session-tabs";
import { SettingsMenu } from "./settings-menu";
import { SituationSettings } from "./situation-settings";
import { UnsentQuestion } from "./unsent-question";
import { useFold } from "./use-fold";
import { useOverview } from "./use-overview";

const EMPTY: Draft = { excluded: [], inputOrder: null };
type RewriteChoice = Pick<Rewrite, "excluded" | "pinned">;
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

export function LensApp({
	scope,
	name,
	threadId,
	initialTitle,
}: {
	scope: string;
	name: string | null;
	threadId: string;
	initialTitle: string;
}) {
	const text = useLensText();
	const { t } = text;
	const locale = useLocale();
	const examples = t.raw("lens.examples") as string[];
	const projectId = scope === ORDINARY ? null : scope;
	const overview = useOverview(scope);
	const stream = useStream<LensState>({
		apiUrl: apiUrl(),
		assistantId: ASSISTANT_ID,
		threadId,
		messagesKey: "messages",
	});

	const { register, drafts } = useSessions();
	const href = `${projectPath(scope)}/chat/${encodeURIComponent(threadId)}`;
	const [input, updateInput] = useState(() => drafts.get(href) ?? "");
	function setInput(value: string) {
		if (value) drafts.set(href, value);
		else drafts.delete(href);
		updateInput(value);
	}
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [preview, setPreview] = useState<Snapshot | null>(null);
	const [previewNonce, setPreviewNonce] = useState(0);
	const [regenTurn, setRegenTurn] = useState<number | null>(null);
	const [stepView, setStepView] = useState<number | "latest">("latest");
	const [sentenceFocus, setSentenceFocus] = useState<{
		turn: number;
		ids: string[];
	} | null>(null);
	const [locateTurn, setLocateTurn] = useState<number | null>(null);
	const [stepsHost, setStepsHost] = useState<HTMLDivElement | null>(null);
	const [inspecting, setInspecting] = useState(true);
	const [previewError, setPreviewError] = useState(false);
	const [shelfOpen, setShelfOpen] = useState(false);
	const [canvasScale, setCanvasScale] = useState(1);
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
	// A turn is a question with its answer, numbered as the server numbers its records. A question
	// left without one (its run failed or was cancelled) is not a turn: it is shown as not sent, in
	// place, after the turns before it.
	const { turns, unsent } = useMemo(() => {
		const turns: Array<{ q: string; a: string | null }> = [];
		const unsent: Array<{ q: string; id?: string; after: number }> = [];
		let open: { q: string; id?: string } | null = null;
		for (const m of stream.messages) {
			if (m.type === "human") {
				if (open) unsent.push({ ...open, after: turns.length });
				open = { q: plain(m.content), id: m.id };
			} else if (m.type === "ai" && open) {
				turns.push({ q: open.q, a: plain(m.content) });
				open = null;
			}
		}
		if (open) {
			if (stream.isLoading) turns.push({ q: open.q, a: null });
			else unsent.push({ ...open, after: turns.length });
		}
		return { turns, unsent };
	}, [stream.messages, stream.isLoading]);
	const sessionTitle =
		initialTitle || turns[0]?.q.trim().slice(0, 100) || t("lens.newChat");
	useEffect(() => {
		register({ href, scope, projectName: name, title: sessionTitle });
	}, [register, href, scope, name, sessionTitle]);
	const stepsIndex = stepView === "latest" ? turns.length - 1 : stepView;
	const stepsRecord = records[stepsIndex];
	const composing = !inspecting;
	const available = useMemo(
		() =>
			new Map(
				(preview?.candidates ?? []).filter(callable).map((c) => [c.id, c]),
			),
		[preview],
	);
	const effectiveOrder =
		draft.inputOrder ??
		(preview?.selected_ids ?? []).filter((id) => available.has(id));

	const sceneVersion = inspecting
		? (sentenceFocus
				? records[sentenceFocus.turn]
				: records[turns.length - 1]
			)?.versions.at(-1)
		: undefined;
	const sceneCandidates = useMemo(() => {
		const map = new Map((preview?.candidates ?? []).map((c) => [c.id, c]));
		for (const c of sceneVersion?.candidates ?? []) map.set(c.id, c);
		return [...map.values()];
	}, [preview, sceneVersion]);
	const sceneSelected =
		sceneVersion?.selected_ids ?? preview?.selected_ids ?? [];
	const extracted = useMemo(() => {
		const ids = new Set(sceneSelected);
		const relevant = sceneCandidates
			.filter(
				(c) =>
					callable(c) &&
					!ids.has(c.id) &&
					((c.relevance ?? 0) > 0 || c.retrieval_rank),
			)
			.sort(
				(a, b) =>
					(b.relevance ?? (b.retrieval_rank ? 1 / b.retrieval_rank : 0)) -
					(a.relevance ?? (a.retrieval_rank ? 1 / a.retrieval_rank : 0)),
			)
			.slice(0, 6);
		for (const c of relevant) ids.add(c.id);
		return ids;
	}, [sceneCandidates, sceneSelected]);

	const addToInput = useCallback(
		(id: string, before?: string) => {
			if (!available.has(id) || before === id) return;
			setInspecting(false);

			setDraft((d) => {
				const order = without(d.inputOrder ?? effectiveOrder, id);
				const at = before ? order.indexOf(before) : -1;
				order.splice(at < 0 ? order.length : at, 0, id);
				return { excluded: without(d.excluded, id), inputOrder: order };
			});
		},
		[available, effectiveOrder],
	);

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
		const t = setTimeout(
			() => {
				previewContext(valuesRef.current, input.trim(), projectId, draft)
					.then((s) => {
						if (live) {
							setPreview(s);
							setPreviewError(false);
						}
					})
					.catch(() => {
						if (live) setPreviewError(true);
					});
			},
			input.trim() ? 220 : 0,
		);
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
	const worldRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const trayRef = useRef<HTMLDivElement>(null);
	const sheetRef = useRef<HTMLElement>(null);
	const msgsRef = useRef<HTMLDivElement>(null);
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const noteRef = useRef<HTMLDivElement>(null);
	const shelfRef = useRef<HTMLButtonElement>(null);
	const resourcesRef = useRef<HTMLDivElement>(null);
	const stepsPanelRef = useRef<HTMLElement>(null);
	const toolsRef = useRef<HTMLDivElement>(null);
	const engineRef = useRef<FieldEngine | null>(null);
	const viewRef = useRef<View>({ kind: "draft", snapshot: null });
	const sticky = useRef<string[] | null>(null);

	useLayoutEffect(() => {
		const panel = stepsPanelRef.current;
		const tools = toolsRef.current;
		if (
			locateTurn === null ||
			stepsIndex !== locateTurn ||
			!stepsHost ||
			!panel ||
			!tools
		)
			return;
		engineRef.current?.locateSteps(panel, tools);
		setLocateTurn(null);
	}, [locateTurn, stepsIndex, stepsHost]);

	const ctx = useRef({
		composing,
		preview,
		records,
		draft,
		text,
		shelfOpen,
		sentenceFocus,
		extracted,
	});
	ctx.current = {
		composing,
		preview,
		records,
		draft,
		text,
		shelfOpen,
		sentenceFocus,
		extracted,
	};

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
		const form = rel(formRef.current?.querySelector("[data-input-zone]")) ?? {
			x: 0,
			y: 0,
			w: 0,
			h: 0,
		};
		const {
			composing: drafting,
			preview: snap,
			records: recs,
			text: tx,
		} = ctx.current;
		const vt = drafting
			? null
			: (ctx.current.sentenceFocus?.turn ?? viewTurn());
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
			(c) =>
				FIELD_LAYERS.includes(c.layer) &&
				c.status !== "trashed" &&
				ctx.current.extracted.has(c.id),
		);
		const state: Record<string, CardState> = {};
		visible.forEach((c) => {
			state[c.id] = cardState(c, selected);
			if (state[c.id] === "idle" && ctx.current.extracted.has(c.id))
				state[c.id] = "near";
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
			toolsRef.current.style.left = `${sheet.x + sheet.w + 12}px`;
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
			fieldRight: rel(resourcesRef.current)?.x,
			fieldBottom: stepsPanelRef.current?.offsetTop,
			cards: visible.map((c) => {
				const title = tx.title(c);
				return {
					id: c.id,
					layer: c.layer,
					title: c.layer === "retrieval" ? c.source_label || title : title,
					content: c.content,
					previewUrl:
						c.layer === "retrieval" && projectId && c.id.startsWith("doc-")
							? `/api/lens/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(c.id)}/thumbnail`
							: undefined,
					previewLabel: tx.t("field.preview", { title }),
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
			pinned: new Set(v ? v.pinned : (ctx.current.draft.inputOrder ?? [])),
			anchors,
			sheet,
			form,
			answer,
			floor: (() => {
				const resources = rel(resourcesRef.current);
				const tools = rel(toolsRef.current);
				const floor = Math.max(
					sheet.y + sheet.h,
					resources ? resources.y + resources.h : 0,
					tools ? tools.y + tools.h : 0,
				);
				if (window.innerWidth <= 900 && stepsPanelRef.current) {
					stepsPanelRef.current.style.setProperty(
						"--mobile-steps-top",
						floor + "px",
					);
					return floor + stepsPanelRef.current.offsetHeight;
				}
				return floor;
			})(),
			shelf: ctx.current.shelfOpen,
		};
	}, [viewTurn, projectId]);

	// ---------- focus (depth of field) ----------
	const focus = useCallback((ids: string[] | null, turn?: number) => {
		engineRef.current?.highlight(ids);
		const root = stageRef.current;
		if (!root) return;
		root
			.querySelectorAll(".seg.hl, .sg.hl, .item.hl, [data-field-id].hl")
			.forEach((e) => {
				e.classList.remove("hl");
			});
		if (!ids) return;
		root.querySelectorAll<HTMLElement>("[data-field-id]").forEach((el) => {
			if (ids.includes(el.dataset.fieldId!)) el.classList.add("hl");
		});
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
			setSentenceFocus(ids && turn !== undefined ? { turn, ids } : null);
			focus(ids, turn);
		},
		[focus],
	);

	// ---------- changes ----------
	const submitRegen = useCallback(
		(turn: number, req: Record<string, unknown>) => {
			setRegenTurn(turn);
			stream.submit(
				{ regen_request: { turn, ...req }, locale } as Partial<LensState>,
				// One checkpoint per turn: the server saves when the run ends.
				{ durability: "exit" },
			);
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
		(note: Change, fn: (d: RewriteChoice) => RewriteChoice) => {
			const view = viewRef.current;
			if (stream.isLoading) {
				toast(t("toast.waitForAnswer"));
				return;
			}
			if (view.kind === "draft") {
				setDraft((d) => {
					const next = fn({
						excluded: d.excluded,
						pinned: d.inputOrder ?? effectiveOrder,
					});
					return { excluded: next.excluded, inputOrder: next.pinned };
				});
				setPreviewNonce((n) => n + 1);
				return;
			}
			const v = view.record.versions[view.record.versions.length - 1];
			const next = fn({ excluded: v.excluded, pinned: v.pinned });
			void rewrite(view.turn, { ...next, note: [note] });
		},
		[rewrite, stream.isLoading, toast, t, effectiveOrder],
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
				addToInput(id);
				return;
			}
			if (target === "tray" && s !== "ex" && view.kind === "turn") exclude(id);
		},
		[addToInput, exclude],
	);

	const noSource = t("toast.noSource");
	const handlers = useRef({ model, onDrop, exclude, hover, pin, noSource });
	handlers.current = { model, onDrop, exclude, hover, pin, noSource };

	useEffect(() => {
		const engine = new FieldEngine(
			stageRef.current!,
			worldRef.current!,
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
				onScale: setCanvasScale,
			},
		);
		engineRef.current = engine;
		engine.start();
		engine.highlight(sticky.current);
		return () => {
			engine.destroy();
			engineRef.current = null;
		};
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

			setInspecting(true);

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
	// `replacing` is a question that was not sent: it leaves the conversation as the new one goes in.
	const ask = (q: string, choices: Draft, replacing?: string) => {
		const pendingId = `pending-${Date.now()}`;
		stream.submit(
			{
				messages: [
					...(replacing
						? [{ type: "remove", id: replacing, content: "" }]
						: []),
					{ type: "human", content: q },
				],
				project_id: projectId,
				context_policies: choices.excluded.map((id) => ({
					item_id: id,
					status: "temporarily_ignored",
				})),
				input_order: choices.inputOrder,
				regen_request: null,
				locale,
			} as Partial<LensState>,
			{
				durability: "exit",
				optimisticValues: (prev) => ({
					...prev,
					messages: [
						...(prev.messages ?? []).filter((m) => m.id !== replacing),
						{ type: "human", content: q, id: pendingId },
					],
				}),
			},
		);
		setInspecting(true);
		setStepView("latest");
		requestAnimationFrame(() => {
			msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
		});
	};

	const send = (e: React.FormEvent) => {
		e.preventDefault();
		const q = input.trim();
		if (
			!q ||
			stream.isThreadLoading ||
			stream.isLoading ||
			effectiveOrder.some((id) => !available.has(id))
		)
			return;
		ask(q, draft);
		setInput("");
		setDraft(EMPTY);
	};

	// Only the latest question is sent again, where it stands, with its context chosen afresh; the
	// draft being composed stays. An earlier one is behind a conversation that went on without it.
	const retry = (u: { q: string; id?: string }) => {
		if (stream.isThreadLoading || stream.isLoading) return;
		ask(u.q, EMPTY, u.id);
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
		composing && (input.trim() || effectiveOrder.length),
	);
	const pending = turns.length > 0 && stream.isLoading && regenTurn === null;
	// The scope picker joins the row once the overview arrives, and shows a situation's name.
	const headRef = useFold<HTMLDivElement>(
		JSON.stringify([locale, scope, overview.data?.projects.map((p) => p.name)]),
	);

	// The question just sent failed: its error is told beside it rather than below the conversation.
	const lastUnsent =
		unsent.at(-1)?.after === turns.length ? unsent.at(-1) : undefined;
	const unsentAfter = (n: number) =>
		unsent
			.filter((u) => u.after === n)
			.map((u, k) => (
				<UnsentQuestion
					// biome-ignore lint/suspicious/noArrayIndexKey: an unsent question may have no id yet
					key={u.id ?? `unsent-${n}-${k}`}
					question={u.q}
					latest={u === lastUnsent}
					error={u === lastUnsent ? stream.error : undefined}
					busy={stream.isLoading || stream.isThreadLoading}
					onRetry={() => retry(u)}
				/>
			));

	const entering = useHistoryLoading(stream.isThreadLoading);
	return (
		<>
			{entering && <PageLoading />}
			<div
				inert={entering}
				className="lens-root"
				ref={stageRef}
				tabIndex={0}
				style={
					{
						// Badge text drawn by CSS (::after) on cards the engine renders.
						"--t-pinned": JSON.stringify(t("lens.badgePinned")),
						"--t-near": JSON.stringify(t("field.related")),
					} as React.CSSProperties
				}
			>
				<div className="canvas-backdrop" aria-hidden="true" />
				<div className="canvas-world" ref={worldRef}>
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
					{stepsRecord && (
						<section
							ref={stepsPanelRef}
							id="turn-steps-canvas"
							tabIndex={-1}
							className="steps-canvas"
							aria-label={t("turnSteps.heading")}
						>
							<header>
								<h2>
									{t("turnSteps.turnHeading", { n: Number(stepsIndex) + 1 })}
								</h2>
							</header>
							<div ref={setStepsHost} />
						</section>
					)}
				</div>

				<section
					className="lens-sheet"
					ref={sheetRef}
					aria-label={t("lens.conversation")}
				>
					<div className="lens-head">
						<div className="lens-head-row" ref={headRef}>
							<Button
								variant="secondary"
								size="sm"
								className="min-w-0 max-w-[170px]"
								nativeButton={false}
								render={<Link href={projectPath(scope)} />}
							>
								<span className="truncate">{name ?? t("lens.ordinary")}</span>
							</Button>
							<nav
								className="lens-head-actions"
								aria-label={t("lens.navigation")}
							>
								<Button
									variant="quiet"
									size="sm"
									className="lens-fold-btn"
									nativeButton={false}
									render={<Link href={projectPath(scope) + "?tab=memories"} />}
									title={t(
										scope === ORDINARY
											? "library.globalTitle"
											: "library.projectTitle",
									)}
								>
									<Library aria-hidden="true" />
									<span>
										{t(
											scope === ORDINARY
												? "library.globalTitle"
												: "library.projectTitle",
										)}
									</span>
								</Button>
								<SettingsMenu
									onManageModels={() => setManagingModels(true)}
									onManageSituations={() => setManagingSituations(true)}
								/>
							</nav>
						</div>
						<ConversationTitle
							threadId={threadId}
							title={initialTitle || turns[0]?.q.trim().slice(0, 100) || ""}
						/>
					</div>
					{overview.data && (
						<Inbox overview={overview.data} onChanged={overview.reload} />
					)}
					<div className="lens-msgs" ref={msgsRef}>
						{!stream.isThreadLoading && turns.length === 0 && (
							<div className="lens-empty">
								<b>{t("lens.emptyTitle")}</b>
								<span>{t("lens.emptyBody")}</span>
								<div className="lens-chips">
									{examples.map((q) => (
										<Button
											key={q}
											type="button"
											variant="secondary"
											size="sm"
											className="h-auto max-w-full rounded-2xl py-1.5 leading-[1.45] text-balance whitespace-normal"
											onClick={() => {
												setInput(q);
												inputRef.current?.focus();
											}}
										>
											{q}
										</Button>
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
									{unsentAfter(i)}
									<div className="lens-q">{t.q}</div>
									{(rec || streaming !== null) && (
										<AnswerCard
											sourceFocus={
												sentenceFocus?.turn === i ? sentenceFocus.ids : null
											}
											stepsHost={
												stepsRecord && stepsIndex === i ? stepsHost : null
											}
											onShowSteps={() => {
												setStepView(i);
												setLocateTurn(i);
											}}
											index={i}
											record={rec}
											streamingText={streaming}
											busy={regenTurn === i}
											usage={usage}
											onRewrite={(turn, change) => void rewrite(turn, change)}
											onUndo={(turn) => submitRegen(turn, { action: "undo" })}
											onHover={(ids, turn) => hover(ids, turn)}
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
						{unsentAfter(turns.length)}
						{stream.error && !lastUnsent ? (
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
						<OrderedInput
							order={effectiveOrder}
							candidates={available}
							onAdd={addToInput}
							onMove={addToInput}
							onRemove={(id) =>
								setDraft((d) => ({
									...d,
									excluded: [...without(d.excluded, id), id],
									inputOrder: without(d.inputOrder ?? effectiveOrder, id),
								}))
							}
						/>
						<ContextMeter
							items={items}
							details={composingNext || turns.length === 0}
							pressed={stripRemovals}
							onRemove={(id) => {
								setStripRemovals((n) => n + 1);
								setDraft((d) => ({
									excluded: available.has(id)
										? d.excluded
										: [...without(d.excluded, id), id],
									inputOrder: without(d.inputOrder ?? effectiveOrder, id),
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
								onChange={(e) => {
									pin(null);
									setInput(e.target.value);
									setInspecting(false);
								}}
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
									disabled={
										!input.trim() ||
										stream.isThreadLoading ||
										stream.isLoading ||
										effectiveOrder.some((id) => !available.has(id))
									}
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

				<div ref={resourcesRef} className="scene-resources">
					<ContextField
						candidates={sceneCandidates.filter((c) => !extracted.has(c.id))}
						query={input}
						order={effectiveOrder}
						onAdd={addToInput}
						onHover={hover}
						error={previewError}
						onRetry={() => setPreviewNonce((n) => n + 1)}
					/>
				</div>
				{/* Which request the field shows, and its tools; only what is needed right now shows. */}
				<div className="lens-fieldbar" ref={toolsRef}>
					<Button
						type="button"
						variant="quiet"
						size="sm"
						onClick={() => {
							pin(null);
							setInspecting(false);
						}}
					>
						{t("field.next")}
					</Button>
					<div className="lens-field-note" ref={noteRef} />
					{placed > 0 && (
						<Button
							type="button"
							variant="quiet"
							size="sm"
							onClick={() => engineRef.current?.tidy()}
						>
							{t("lens.tidy", { count: placed })}
						</Button>
					)}
					<div
						className="canvas-zoom-controls"
						role="group"
						aria-label={t("field.zoom")}
					>
						<button
							type="button"
							aria-label={t("field.zoomOut")}
							title={t("field.zoomOut")}
							disabled={canvasScale <= 0.25}
							onClick={() => engineRef.current?.zoomBy(0.8)}
						>
							<Minus />
						</button>
						<span>{Math.max(1, Math.round(canvasScale * 100))}%</span>
						<button
							type="button"
							aria-label={t("field.zoomIn")}
							title={t("field.zoomIn")}
							disabled={canvasScale >= 4}
							onClick={() => engineRef.current?.zoomBy(1.25)}
						>
							<Plus />
						</button>
						<button
							type="button"
							className="canvas-fit"
							onClick={() => engineRef.current?.fitAll()}
						>
							<Maximize />
							{t("field.fitAll")}
						</button>
					</div>
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
		</>
	);
}
