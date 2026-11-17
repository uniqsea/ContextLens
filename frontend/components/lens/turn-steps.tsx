"use client";

import { ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useLensText } from "@/lib/lens/text";
import {
	type AnswerVersion,
	type Candidate,
	type Layer,
	layerColor,
	type ModelCall,
	stripMarkers,
	type ToolStep,
	type TraceMessage,
} from "@/lib/lens/types";
import type { MemoryChange } from "@/lib/memory-types";
import { ChangeItem, type MemoryUndo } from "./memory-changes";
import {
	ContextStrip,
	type StripItem,
	stripItems,
	stripTokens,
} from "./context-meter";
import { type FlowNode, StepFlow } from "./step-flow";
import {
	Collapsible,
	CollapsibleChevron,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

/** A step's card: its title opens the step's details, the rest says what the step came to. */
function Card({
	title,
	color,
	open,
	onOpen,
	children,
}: {
	title: string;
	/** A source or a tool result carries its kind's colour. */
	color?: string;
	open: boolean;
	onOpen: () => void;
	children?: ReactNode;
}) {
	return (
		<div className="turn-step" data-open={open || undefined}>
			<button
				type="button"
				className="step-title"
				aria-expanded={open}
				onClick={onOpen}
			>
				{color && <i style={{ background: color }} />}
				<span>{title}</span>
				<ChevronRight aria-hidden="true" />
			</button>
			{children}
		</div>
	);
}

type Artifact = NonNullable<ToolStep["artifact"]>;
/** Older checkpoints stored a tool's artifact as a list; those carry nothing to show. */
const artifactOf = (step: ToolStep): Artifact =>
	step.artifact && !Array.isArray(step.artifact) ? step.artifact : {};

/** The memories and files a tool call came back with. */
const sourceIds = (step: ToolStep) => {
	const found = artifactOf(step);
	return [
		...(found.memories ?? []).map((m) => (typeof m === "string" ? m : m.id)),
		found.document?.id,
		...(found.documents ?? []).map((d) => d.id),
	].filter((value): value is string => !!value);
};

/** An answer's opening as plain words: the card has no room for its markup. */
const plain = (value: string) => value.replace(/[*_`#>]+/g, "").trim();

const SUBJECTS = [
	"query",
	"what_changed",
	"name",
	"learned",
	"pattern",
	"file_path",
	"path",
];
/** What a tool was asked about: the argument a person would read, not the whole call. */
function subject(args: Record<string, unknown>) {
	const named = SUBJECTS.map((key) => args[key]).find(
		(value) => typeof value === "string" && value,
	);
	const any = Object.values(args).find(
		(value) => typeof value === "string" && value,
	);
	return (named ?? any ?? "") as string;
}

function Messages({ messages }: { messages: TraceMessage[] }) {
	const t = useTranslations("turnSteps");
	return messages.map((m, index) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: the recorded message order is immutable
		<div className="step-message" key={index}>
			<b>
				{t.has(`role.${m.role}` as "role.user")
					? t(`role.${m.role}` as "role.user")
					: m.role}
			</b>
			{m.content && <pre>{m.content}</pre>}
			{m.tool_calls?.map((c, i) => (
				<pre key={c.id ?? `${c.name}-${i}`}>
					{c.name}
					{"\n"}
					{JSON.stringify(c.args, null, 2)}
				</pre>
			))}
		</div>
	));
}

function Calls({ calls }: { calls: ModelCall[] }) {
	const t = useTranslations("turnSteps");
	return calls.map((call, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: captured calls are immutable and ordered
		<div className="step-exchange" key={i}>
			<h5>{t("sent")}</h5>
			<Messages messages={call.messages} />
			{call.tools && call.tools.length > 0 && (
				<Collapsible className="grid gap-1.5">
					<CollapsibleTrigger
						render={
							<Button
								variant="quiet"
								size="xs"
								className="-ml-2 justify-self-start"
							/>
						}
					>
						<CollapsibleChevron />
						{t("toolSchemas", { count: call.tools.length })}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<pre>{JSON.stringify(call.tools, null, 2)}</pre>
					</CollapsibleContent>
				</Collapsible>
			)}
			<h5>{t("returned")}</h5>
			{call.output ? (
				<Messages messages={[call.output]} />
			) : (
				<span>{t(call.failed ? "failed" : "missing")}</span>
			)}
		</div>
	));
}

const SOURCES: Layer[] = ["memory", "retrieval", "short_term"];

export function TurnSteps({
	sourceFocus,
	version,
	query,
	rewrite,
	readingControls,
	contextControls,
	unfolded = false,
	changes: recorded,
	sources = false,
	paneHost,
	onHover,
	undoing,
}: {
	sourceFocus: string[] | null;
	version: AnswerVersion;
	query: string;
	rewrite: boolean;
	readingControls: ReactNode;
	contextControls: ReactNode;
	/** Start with every tool round laid out, as the conversation map shows a turn. */
	unfolded?: boolean;
	/** Every memory change the turn made, where the map shows them all; the version's own otherwise. */
	changes?: MemoryChange[];
	/** Draw each source the request carried as its own node, where no field stands beside the flow. */
	sources?: boolean;
	/** Where an opened step's details go, so the flow keeps its shape; below the flow without one. */
	paneHost?: HTMLElement | null;
	/** Pointing at a step brings the sources it is about forward, in the field and in the answer. */
	onHover?: (ids: string[] | null) => void;
	/** Lets the writing step take its changes back, where the turn's answer can. */
	undoing?: MemoryUndo;
}) {
	const t = useTranslations("turnSteps");
	const text = useLensText();
	const [open, setOpen] = useState<string | null>(null);
	// Where the details have been dragged to, kept while other steps are opened.
	const [moved, setMoved] = useState({ x: 0, y: 0 });
	const [moving, setMoving] = useState(false);
	const details = new Map<string, { title: string; body: ReactNode }>();
	const card = (
		id: string,
		title: string,
		face: ReactNode,
		body: ReactNode,
		color?: string,
	) => {
		details.set(id, { title, body });
		return (
			<Card
				title={title}
				color={color}
				open={open === id}
				onOpen={() => setOpen((o) => (o === id ? null : id))}
			>
				{face}
			</Card>
		);
	};
	const raw = (children: ReactNode) => (
		<Collapsible className="step-raw">
			<CollapsibleTrigger
				render={
					<Button
						variant="quiet"
						size="xs"
						className="-ml-2 justify-self-start"
					/>
				}
			>
				<CollapsibleChevron />
				{t("raw")}
			</CollapsibleTrigger>
			<CollapsibleContent className="step-raw-body">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
	const toolName = (name: string) =>
		t.has(`toolName.${name}` as "toolName.recall")
			? t(`toolName.${name}` as "toolName.recall")
			: name;
	const byId = new Map(version.candidates.map((c) => [c.id, c]));
	// Turns recorded before the assembled request was kept still know what they carried.
	const selected = (version.assembled_ids ?? version.selected_ids)
		.map((id) => byId.get(id))
		.filter((c) => c !== undefined);
	const reading = version.situation;
	const tools = version.steps ?? [];
	const orderedTools = new Set<string>();
	const changes = recorded ?? version.written_changes ?? [];
	// Who made a change is said only when the step holds more than one author's.
	const mixed = new Set(changes.map((c) => c.actor)).size > 1;
	const columns: FlowNode[][] = [];
	// The request as it grows: the question alone, then what was assembled, then each tool result
	// as a call takes it in. A result's size is estimated from its text, like the question's.
	const all = stripItems(
		version.candidates,
		version.assembled_ids ?? version.selected_ids,
		query,
		text,
	);
	const resultLayer = (step: ToolStep) => {
		const found = artifactOf(step);
		return found.document || found.documents?.length
			? ("retrieval" as const)
			: found.memories?.length
				? ("memory" as const)
				: null;
	};
	const taken: StripItem[] = [];
	const materials = selected.filter((c) => SOURCES.includes(c.layer));

	const toolNode = (step: ToolStep, id: string) => {
		const found = artifactOf(step);
		const ids = sourceIds(step);
		const hits = ids
			.map((value) => byId.get(value))
			.filter((c): c is Candidate => !!c);
		const count = ids.length + (found.history?.length ?? 0);
		const wrote = found.events?.length ?? 0;
		const searched = !!(
			found.memories ||
			found.document ||
			found.documents ||
			found.history
		);
		const about = subject(step.args);
		const outcome =
			step.result === null
				? t("missing")
				: wrote
					? t("wroteCount", { count: wrote })
					: searched
						? count
							? t("hitCount", { count })
							: t("noHits")
						: step.result.split("\n")[0];
		const layer = resultLayer(step);
		return card(
			id,
			toolName(step.tool),
			<>
				{about && <p className="step-say">{about}</p>}
				<p className="step-foot">{outcome}</p>
				{hits.length > 0 && (
					<ul className="step-hits">
						{hits.slice(0, 3).map((c) => (
							<li key={c.id}>{text.title(c)}</li>
						))}
						{hits.length > 3 && (
							<li>{t("more", { count: hits.length - 3 })}</li>
						)}
					</ul>
				)}
			</>,
			<>
				{about && (
					<>
						<h5>{t("asked")}</h5>
						<p>{about}</p>
					</>
				)}
				<h5>{outcome}</h5>
				{hits.map((c) => (
					<div className="step-message" key={c.id}>
						<b>{text.title(c)}</b>
						<p>{c.content}</p>
					</div>
				))}
				{raw(
					<>
						<h5>{t("arguments")}</h5>
						<pre>{JSON.stringify(step.args, null, 2)}</pre>
						{found.reading_calls && <Calls calls={found.reading_calls} />}
						<h5>{t("result")}</h5>
						<pre>{step.result ?? t("missing")}</pre>
					</>,
				)}
			</>,
			layer ? layerColor(layer) : undefined,
		);
	};

	const question: FlowNode = {
		id: "question",
		from: [],
		body: (
			<div className="flow-source">
				<b>{t("question")}</b>
				<p>{query}</p>
			</div>
		),
		highlight: sourceFocus?.includes("usr-001"),
		ids: ["usr-001"],
	};
	const asking: FlowNode[] = [question];
	columns.push(asking);
	const preparation: FlowNode[] = [];
	if (reading) {
		const marks = [...reading.scenes, ...reading.concepts];
		preparation.push({
			id: "reading",
			from: rewrite ? [] : ["question"],
			body: card(
				"reading",
				t(rewrite ? "reuseReading" : "reading"),
				<>
					<p className="step-say">{reading.doing || t("none")}</p>
					{marks.length > 0 && (
						<p className="step-chips">
							{marks.map((mark) => (
								<span key={mark}>{mark}</span>
							))}
						</p>
					)}
					{reading.degraded && !rewrite && (
						<p className="step-foot">{t("degraded")}</p>
					)}
				</>,
				<>
					{readingControls}
					{version.reading_calls?.length
						? raw(<Calls calls={version.reading_calls} />)
						: !rewrite && (
								<p>{t(version.reading_calls ? "noCall" : "legacy")}</p>
							)}
				</>,
			),
		});
	}
	if (sources)
		for (const source of materials)
			preparation.push({
				id: "source-" + source.id,
				lane: "input",
				from: [],
				color: layerColor(source.layer),
				ids: [source.id],
				highlight: sourceFocus?.includes(source.id),
				body: card(
					"source-" + source.id,
					text.title(source),
					null,
					<p>{source.content}</p>,
					layerColor(source.layer),
				),
			});
	if (version.writing_calls || recorded?.length) {
		const settled =
			!version.writing_calls || version.writing_calls.some((c) => c.output);
		asking.push({
			id: "writing",
			lane: "side",
			from: [],
			body: card(
				"writing",
				changes.length ? t("wrote", { count: changes.length }) : t("write"),
				changes.length ? (
					<ul className="mem-changes">
						{changes.slice(0, 3).map((c) => (
							<ChangeItem
								key={c.event_id}
								change={c}
								undoing={undoing}
								clamp
								showActor={mixed}
							/>
						))}
						{changes.length > 3 && (
							<li className="step-foot">
								{t("more", { count: changes.length - 3 })}
							</li>
						)}
					</ul>
				) : (
					<p className="step-foot">
						{t(settled ? "noWrites" : "noWritesFailed")}
					</p>
				),
				<>
					{changes.length === 0 && <p>{t("noWrites")}</p>}
					{changes.length > 0 && (
						<ul className="mem-changes">
							{changes.map((c) => (
								<ChangeItem
									key={c.event_id}
									change={c}
									undoing={undoing}
									showActor={mixed}
								/>
							))}
						</ul>
					)}
					{undoing?.error && <p role="alert">{undoing.error}</p>}
					{version.writing_calls &&
						(version.writing_calls.length ? (
							raw(<Calls calls={version.writing_calls} />)
						) : (
							<p>{t("noCall")}</p>
						))}
				</>,
			),
		});
	}
	columns.push(preparation);
	const materialFocus =
		materials.some((c) => sourceFocus?.includes(c.id)) ||
		sourceFocus?.includes("sys-001") ||
		sourceFocus?.includes("sys-project") ||
		sourceFocus?.includes("usr-001");
	const kinds = SOURCES.map((layer) => ({
		layer,
		n: materials.filter((c) => c.layer === layer).length,
	})).filter((kind) => kind.n);
	const assembling: FlowNode[] = [
		{
			id: "assemble",
			from: [
				...(reading ? ["reading"] : ["question"]),
				...(sources ? materials.map((c) => "source-" + c.id) : []),
			],
			highlight: materialFocus,
			ids: materials.map((c) => c.id),
			body: card(
				"assemble",
				t("assemble"),
				<>
					<p className="step-figure">
						<b>{materials.length}</b>
						<span>{t("sourcesUnit", { count: materials.length })}</span>
						<small>{t("tokens", { count: stripTokens(all) })}</small>
					</p>
					<ContextStrip items={all} mini />
					<p className="step-foot">
						{kinds.length
							? kinds
									.map((kind) => `${text.layer(kind.layer)} ${kind.n}`)
									.join(" · ")
							: t("noSources")}
					</p>
				</>,
				<>
					{contextControls ? (
						<div className="step-editor">{contextControls}</div>
					) : (
						materials.map((c) => (
							<div className="step-message" key={c.id}>
								<b>{text.title(c)}</b>
								<p>{c.content}</p>
							</div>
						))
					)}
					{raw(<Messages messages={version.payload} />)}
				</>,
			),
		},
	];
	columns.push(assembling);
	const [expanded, setExpanded] = useState(unfolded);
	const calls = version.agent_calls ?? [];
	const consumed = new Set<string>();
	let routeActive = !!materialFocus;
	let firstCall: FlowNode[] | undefined;
	calls.forEach((call, i) => {
		const requested = call.output?.tool_calls ?? [];
		const results = requested.flatMap((c) => {
			const step = tools.find((s) => s.call_id === c.id);
			if (!step?.call_id) return [];
			orderedTools.add(step.call_id);
			return [step];
		});
		const said = call.output?.content && stripMarkers(call.output.content);
		// The calls follow one another; what each asked for hangs under it and needs no wire of its own.
		const from = [i === 0 ? "assemble" : `call-${i - 1}`];
		for (const msg of call.messages) {
			const id = msg.tool_call_id;
			if (id && orderedTools.has(id) && !consumed.has(id)) {
				consumed.add(id);
				const step = tools.find((s) => s.call_id === id);
				const layer = step && resultLayer(step);
				if (step && layer)
					taken.push({
						id: "tool-" + id,
						label: toolName(step.tool),
						tokens: Math.max(12, Math.round((step.result ?? "").length * 1.3)),
						layer,
					});
			}
		}
		const answerCall = i === calls.length - 1 && !requested.length;
		// The question stays last, as in the request itself.
		const carried = [...all.slice(0, -1), ...taken, ...all.slice(-1)];
		const asked = new Map<string, number>();
		for (const c of requested) asked.set(c.name, (asked.get(c.name) ?? 0) + 1);
		const column: FlowNode[] = [
			{
				id: "call-" + i,
				from,
				highlight: routeActive || (sourceFocus !== null && answerCall),
				body: card(
					"call-" + i,
					t("call", { n: i + 1 }),
					requested.length ? (
						<>
							<p className="step-say">
								{t("decided", { count: requested.length })}
							</p>
							<p className="step-chips">
								{[...asked].map(([name, n]) => (
									<span key={name}>
										{toolName(name)}
										{n > 1 && ` ×${n}`}
									</span>
								))}
							</p>
						</>
					) : (
						<>
							<p className="step-say">
								{said ? plain(said) : t(call.failed ? "failed" : "missing")}
							</p>
							<ContextStrip items={carried} mini />
							{consumed.size > 0 && (
								<p className="step-foot">
									{t("withResults", { count: consumed.size })}
								</p>
							)}
						</>
					),
					<>
						{said && (
							<>
								<h5>{t("returned")}</h5>
								<p className="step-text">{said}</p>
							</>
						)}
						{requested.length > 0 && (
							<>
								<h5>{t("asksFor")}</h5>
								{requested.map((c, k) => (
									<div className="step-message" key={c.id ?? `${c.name}-${k}`}>
										<b>{toolName(c.name)}</b>
										<p>{subject(c.args)}</p>
									</div>
								))}
							</>
						)}
						{!said && !requested.length && (
							<p>{t(call.failed ? "failed" : "missing")}</p>
						)}
						{raw(<Calls calls={[call]} />)}
					</>,
				),
			},
		];
		// What a call asked for hangs under it; the next call takes each result in along a wire.
		for (const step of results) {
			const ids = sourceIds(step);
			const highlight = ids.some((id) => sourceFocus?.includes(id));
			if (highlight) routeActive = true;
			column.push({
				id: "tool-" + step.call_id,
				lane: "result",
				from: [],
				ids,
				highlight,
				body: toolNode(step, "tool-" + step.call_id),
			});
		}
		firstCall ??= column;
		columns.push(column);
	});
	if (!calls.length)
		columns.push([
			{
				id: "legacy-answer",
				from: ["assemble"],
				highlight: sourceFocus !== null,
				body: card(
					"legacy-answer",
					t("answer"),
					<p className="step-say">{plain(version.content)}</p>,
					<>
						<p>{t("legacy")}</p>
						<p className="step-text">{version.content}</p>
					</>,
				),
			},
		]);
	// Tools from before calls were recorded ran between assembling and answering.
	tools
		.filter((s) => !s.call_id || !orderedTools.has(s.call_id))
		.forEach((step, i) => {
			(firstCall ?? assembling).push({
				id: "unlinked-" + i,
				lane: "result",
				from: [],
				ids: sourceIds(step),
				body: toolNode(step, "unlinked-" + i),
			});
		});
	const shown = open ? details.get(open) : undefined;
	const pane = shown && (
		<aside
			className="step-pane"
			aria-label={shown.title}
			style={
				moved.x || moved.y
					? {
							transform: `translate(${moved.x}px, ${moved.y}px)`,
							// Moved down, it gives up height rather than run off the bottom.
							maxHeight: `calc(100% - ${Math.max(0, moved.y)}px)`,
						}
					: undefined
			}
		>
			<header
				data-moving={moving || undefined}
				onPointerDown={(e) => {
					if (e.button !== 0 || (e.target as Element).closest("button")) return;
					e.preventDefault();
					e.stopPropagation();
					const header = e.currentTarget;
					const box = header.parentElement!.getBoundingClientRect();
					const from = { x: e.clientX - moved.x, y: e.clientY - moved.y };
					// The header stays on screen, so the pane can always be taken back.
					const room = {
						left: -box.left + moved.x,
						right: window.innerWidth - box.right + moved.x,
						top: -box.top + moved.y,
						bottom: window.innerHeight - box.top - 48 + moved.y,
					};
					const clamp = (v: number, lo: number, hi: number) =>
						Math.min(Math.max(v, lo), hi);
					header.setPointerCapture(e.pointerId);
					setMoving(true);
					const move = (ev: PointerEvent) =>
						setMoved({
							x: clamp(ev.clientX - from.x, room.left, room.right),
							y: clamp(ev.clientY - from.y, room.top, room.bottom),
						});
					const end = () => {
						header.removeEventListener("pointermove", move);
						header.removeEventListener("pointerup", end);
						header.removeEventListener("pointercancel", end);
						setMoving(false);
					};
					header.addEventListener("pointermove", move);
					header.addEventListener("pointerup", end);
					header.addEventListener("pointercancel", end);
				}}
				onDoubleClick={() => setMoved({ x: 0, y: 0 })}
			>
				<h3>{shown.title}</h3>
				<Button
					type="button"
					variant="quiet"
					size="icon-sm"
					aria-label={t("closeDetail")}
					onClick={() => setOpen(null)}
				>
					<X />
				</Button>
			</header>
			<div className="step-detail">{shown.body}</div>
		</aside>
	);
	const detail =
		paneHost === undefined ? pane : paneHost && createPortal(pane, paneHost);
	const rounds = calls.filter((c) => c.output?.tool_calls?.length).length;
	const grouped = new Set(
		columns
			.flat()
			.filter(
				(node) =>
					node.id.startsWith("tool-") ||
					(node.id.startsWith("call-") &&
						calls[Number(node.id.slice(5))]?.output?.tool_calls?.length),
			)
			.map((node) => node.id),
	);
	// One round and its results read at a glance; more of them fold into a single step.
	const canFold = rounds > 2;
	if (canFold && !expanded) {
		const summary: FlowNode = {
			id: "tool-rounds",
			highlight: columns
				.flat()
				.some((node) => grouped.has(node.id) && node.highlight),
			from: [],
			body: (
				<button
					type="button"
					className="flow-source flow-fold"
					onClick={() => setExpanded(true)}
				>
					<b>{t("toolCount", { n: tools.length })}</b>
					<span>
						{[...new Set(tools.map((step) => toolName(step.tool)))].join(" · ")}
					</span>
					<small>{t("expandTools")} →</small>
				</button>
			),
		};
		let inserted = false;
		const compact = columns.map((col) =>
			col.flatMap((node) => {
				if (!grouped.has(node.id))
					return [
						{
							...node,
							from: [
								...new Set(
									node.from.map((id) => (grouped.has(id) ? summary.id : id)),
								),
							],
						},
					];
				for (const id of node.from)
					if (!grouped.has(id) && !summary.from.includes(id))
						summary.from.push(id);
				if (inserted) return [];
				inserted = true;
				return [summary];
			}),
		);
		return (
			<>
				<StepFlow label={t("heading")} columns={compact} onHover={onHover} />
				{detail}
			</>
		);
	}
	return (
		<>
			{canFold && expanded && (
				<Button
					type="button"
					variant="quiet"
					size="sm"
					onClick={() => setExpanded(false)}
				>
					{t("collapseTools")}
				</Button>
			)}
			<StepFlow label={t("heading")} columns={columns} onHover={onHover} />
			{detail}
		</>
	);
}
