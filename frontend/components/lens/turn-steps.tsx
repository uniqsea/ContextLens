"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useLensText } from "@/lib/lens/text";
import {
	type AnswerVersion,
	type ModelCall,
	stripMarkers,
	type ToolStep,
	type TraceMessage,
} from "@/lib/lens/types";

import { StepFlow, type FlowNode } from "./step-flow";

function Step({
	title,
	input,
	output,
	children,
}: {
	title: string;
	input: string;
	output: string;
	children: ReactNode;
}) {
	const t = useTranslations("turnSteps");
	const [opened, setOpened] = useState(false);
	return (
		<details
			className="turn-step"
			onToggle={(e) => {
				if (e.currentTarget.open) setOpened(true);
			}}
		>
			<summary>
				<span className="step-title">
					{title}
					<ChevronRight aria-hidden="true" />
				</span>
				<span className="step-row">
					<span>{t("input")}</span>
					<span>{input}</span>
				</span>
				<span className="step-row">
					<span>{t("output")}</span>
					<span>{output}</span>
				</span>
			</summary>
			{opened && <div className="step-detail">{children}</div>}
		</details>
	);
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
				<details>
					<summary>{t("toolSchemas", { count: call.tools.length })}</summary>
					<pre>{JSON.stringify(call.tools, null, 2)}</pre>
				</details>
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

function ToolCard({ step }: { step: ToolStep }) {
	const t = useTranslations("turnSteps");
	return (
		<Step
			title={t("tool", { name: step.tool })}
			input={JSON.stringify(step.args)}
			output={step.result ?? t("missing")}
		>
			<h5>{t("arguments")}</h5>
			<pre>{JSON.stringify(step.args, null, 2)}</pre>
			{step.artifact?.reading_calls && (
				<Calls calls={step.artifact.reading_calls} />
			)}
			<h5>{t("result")}</h5>
			<pre>{step.result ?? t("missing")}</pre>
		</Step>
	);
}

export function TurnSteps({
	sourceFocus,
	version,
	query,
	rewrite,
	readingControls,
	contextControls,
}: {
	sourceFocus: string[] | null;
	version: AnswerVersion;
	query: string;
	rewrite: boolean;
	readingControls: ReactNode;
	contextControls: ReactNode;
}) {
	const t = useTranslations("turnSteps");
	const text = useLensText();
	const selected = version.assembled_ids
		?.map((id) => version.candidates.find((c) => c.id === id))
		.filter((c) => c !== undefined);
	const reading = version.situation;
	const readingOutput =
		reading &&
		[reading.doing, ...reading.scenes, ...reading.concepts]
			.filter(Boolean)
			.join(" · ");
	const assembled =
		selected?.map((c) => text.title(c)).join(" · ") || t("prepared");
	const tools = version.steps ?? [];
	const orderedTools = new Set<string>();
	const changes = version.written_changes ?? [];
	const written = changes
		.map((c) => c.content || c.title)
		.filter(Boolean)
		.join(" · ");
	const columns: FlowNode[][] = [];
	const materials = (selected ?? []).filter(
		(c) =>
			c.layer === "memory" ||
			c.layer === "retrieval" ||
			c.layer === "short_term",
	);
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
	};
	columns.push([question]);
	const preparation: FlowNode[] = [];
	if (reading)
		preparation.push({
			id: "reading",
			from: rewrite ? [] : ["question"],
			body: (
				<Step
					title={t(rewrite ? "reuseReading" : "reading")}
					input={rewrite ? reading.doing : query}
					output={
						reading.degraded && !rewrite
							? t("fallback", { text: readingOutput })
							: readingOutput || t("none")
					}
				>
					{version.reading_calls?.length ? (
						<Calls calls={version.reading_calls} />
					) : (
						!rewrite && <p>{t(version.reading_calls ? "noCall" : "legacy")}</p>
					)}
					{readingControls}
				</Step>
			),
		});
	for (const source of materials)
		preparation.push({
			id: "source-" + source.id,
			from: [],
			highlight: sourceFocus?.includes(source.id),
			body: (
				<details className="turn-step">
					<summary className="step-title">{text.title(source)}</summary>
					<div className="step-detail">
						<pre>{source.content}</pre>
					</div>
				</details>
			),
		});
	if (version.writing_calls)
		preparation.push({
			id: "writing",
			from: ["question"],
			body: (
				<Step
					title={t("write")}
					input={query}
					output={
						written ||
						(version.writing_calls.some((c) => c.output)
							? t("noWrites")
							: t("noWritesFailed"))
					}
				>
					{version.writing_calls.length ? (
						<Calls calls={version.writing_calls} />
					) : (
						<p>{t("noCall")}</p>
					)}
					<h5>{t("applied")}</h5>
					<pre>{written || t("noWrites")}</pre>
				</Step>
			),
		});
	columns.push(preparation);
	const materialFocus =
		materials.some((c) => sourceFocus?.includes(c.id)) ||
		sourceFocus?.includes("sys-001") ||
		sourceFocus?.includes("usr-001");
	columns.push([
		{
			id: "assemble",
			from: [
				...(reading ? ["reading"] : ["question"]),
				...materials.map((c) => "source-" + c.id),
			],
			highlight: materialFocus,
			body: (
				<Step
					title={t("assemble")}
					input={[query, reading?.doing]
						.filter(
							(value, index, items) => value && items.indexOf(value) === index,
						)
						.join(" · ")}
					output={assembled}
				>
					<h5>{t("prepared")}</h5>
					<Messages messages={version.payload} />
					<div className="step-editor">{contextControls}</div>
				</Step>
			),
		},
	]);
	const [expanded, setExpanded] = useState(false);
	const calls = version.agent_calls ?? [];
	const consumed = new Set<string>();
	let routeActive = !!materialFocus;
	calls.forEach((call, i) => {
		const last = call.messages.at(-1);
		const requested = call.output?.tool_calls ?? [];
		const results = requested.flatMap((c) => {
			const step = tools.find((s) => s.call_id === c.id);
			if (!step?.call_id) return [];
			orderedTools.add(step.call_id);
			return [step];
		});
		const input = [
			t("messages", { count: call.messages.length }),
			last?.content,
		]
			.filter(Boolean)
			.join(" · ");
		const output = [
			call.output?.content && stripMarkers(call.output.content),
			...requested.map((c) => c.name),
		]
			.filter(Boolean)
			.join(" · ");

		const from = i === 0 ? ["assemble"] : [];
		for (const msg of call.messages) {
			const id = msg.tool_call_id;
			if (id && orderedTools.has(id) && !consumed.has(id)) {
				from.push("tool-" + id);
				consumed.add(id);
			}
		}
		const answerCall = i === calls.length - 1 && !requested.length;
		columns.push([
			{
				id: "call-" + i,
				from,
				highlight: routeActive || (sourceFocus !== null && answerCall),
				body: (
					<Step
						title={t(requested.length ? "chooseTools" : "answer")}
						input={input}
						output={output || t(call.failed ? "failed" : "missing")}
					>
						<Calls calls={[call]} />
					</Step>
				),
			},
		]);
		columns.push(
			results.map((step) => {
				const sources = [
					...(step.artifact?.memories ?? []).map((m) =>
						typeof m === "string" ? m : m.id,
					),
					step.artifact?.document?.id,
				];
				const highlight = sources.some((id) => id && sourceFocus?.includes(id));
				if (highlight) routeActive = true;
				return {
					id: "tool-" + step.call_id,
					from: ["call-" + i],
					highlight,
					body: <ToolCard step={step} />,
				};
			}),
		);
	});
	if (!calls.length)
		columns.push([
			{
				id: "legacy-answer",
				from: ["assemble"],
				highlight: sourceFocus !== null,
				body: (
					<Step
						title={t("answer")}
						input={t("prepared")}
						output={version.content}
					>
						<p>{t("legacy")}</p>
						<pre>{version.content}</pre>
					</Step>
				),
			},
		]);
	const unmatched = tools.filter(
		(s) => !s.call_id || !orderedTools.has(s.call_id),
	);
	if (unmatched.length)
		columns.push(
			unmatched.map((step, i) => ({
				id: "unlinked-" + i,
				from: [],
				body: <ToolCard step={step} />,
			})),
		);
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
	const canFold = grouped.size > 2;
	if (canFold && !expanded) {
		const summary: FlowNode = {
			id: "tool-rounds",
			highlight: columns.flat().some(node => grouped.has(node.id) && node.highlight),
			from: [],
			body: (
				<button
					type="button"
					className="flow-source flow-fold"
					onClick={() => setExpanded(true)}
				>
					<b>{t("toolCount", { n: tools.length })}</b>
					<span>
						{[...new Set(tools.map((step) => step.tool))].join(" · ")}
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
		return <StepFlow label={t("heading")} columns={compact} />;
	}
	return (
		<>
			{canFold && expanded && (
				<button
					type="button"
					className="lens-text-btn"
					onClick={() => setExpanded(false)}
				>
					{t("collapseTools")}
				</button>
			)}
			<StepFlow label={t("heading")} columns={columns} />
		</>
	);
}
