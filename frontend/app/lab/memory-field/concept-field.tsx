"use client";

import { hierarchy, pack } from "d3-hierarchy";
import { interpolateZoom } from "d3-interpolate";
import { ArrowRight, ChevronLeft, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./concept-field.module.css";

type Facet = { name: string; records: number[] };
type Concept = {
	name: string;
	description: string;
	kind: "reading" | "archive";
	facets: Facet[];
};
type Data = {
	records: { text: string; source: string }[];
	concepts: Concept[];
};

export default function ConceptField() {
	const [data, setData] = useState<Data>();
	const [error, setError] = useState(false);
	useEffect(() => {
		const ac = new AbortController();
		fetch("/api/lab/memory-field?source=personal", {
			headers: { "x-memory-field": "inspect" },
			cache: "no-store",
			signal: ac.signal,
		})
			.then(async (r) => {
				if (!r.ok) throw Error();
				return r.json();
			})
			.then(setData)
			.catch(() => {
				if (!ac.signal.aborted) setError(true);
			});
		return () => ac.abort();
	}, []);
	if (!data)
		return (
			<p role="status">{error ? "无法读取本地记忆。" : "正在读取本地记忆…"}</p>
		);
	return data.concepts.length ? (
		<Explorer data={data} />
	) : (
		<p>还没有概念线索。</p>
	);
}
type Item = {
	key: string;
	name: string;
	concept?: number;
	facet?: number;
	record?: number;
	children?: Item[];
};
type View = [number, number, number];

function Explorer({ data }: { data: Data }) {
	const [kind, setKind] = useState<Concept["kind"]>(
		data.concepts.some((c) => c.kind === "reading") ? "reading" : "archive",
	);
	const [key, setKey] = useState("root");
	const [picked, setPicked] = useState<number | null>(null);
	const [library, setLibrary] = useState(false);
	const [query, setQuery] = useState("");
	const canvas = useRef<SVGSVGElement>(null);
	const view = useRef<View>([300, 300, 620]);
	const root = useMemo(() => {
		const children: Item[] = data.concepts.flatMap((c, i) =>
			c.kind !== kind
				? []
				: [
						{
							key: "c" + i,
							name: c.name,
							concept: i,
							children: c.facets.map((f, j) => ({
								key: i + "/" + j,
								name: f.name,
								concept: i,
								facet: j,
								children: f.records.map((r, k) => ({
									key: i + "/" + j + "/" + k,
									name: data.records[r].text,
									concept: i,
									facet: j,
									record: r,
								})),
							})),
						},
					],
		);
		return pack<Item>().size([600, 600]).padding(4)(
			hierarchy<Item>({ key: "root", name: "总览", children })
				.sum((n) => (n.children ? 0 : 1))
				.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
		);
	}, [data, kind]);
	const nodes = useMemo(() => root.descendants(), [root]);
	const focus = nodes.find((n) => n.data.key === key) ?? root;
	const concept =
		focus.data.concept === undefined ? null : data.concepts[focus.data.concept];
	const facet =
		focus.data.facet === undefined ? null : concept?.facets[focus.data.facet];
	const record = picked === null ? null : data.records[picked];
	const jump = (next: string, id: number | null = null) => {
		setKey(next);
		setPicked(id);
		setLibrary(false);
	};
	const select = (index: number, id?: number) => {
		setKind(data.concepts[index].kind);
		const j =
			id === undefined
				? -1
				: data.concepts[index].facets.findIndex((f) => f.records.includes(id));
		jump(j < 0 ? "c" + index : index + "/" + j, id ?? null);
	};
	useLayoutEffect(() => {
		const svg = canvas.current;
		if (!svg) return;
		const dest: View = [focus.x, focus.y, focus.r * 2.08];
		const from = view.current;
		const tween = interpolateZoom(from, dest);
		const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
			.matches
			? 0
			: 560;
		let frame = 0;
		function draw(v: View) {
			view.current = v;
			svg?.setAttribute(
				"viewBox",
				[v[0] - v[2] / 2, v[1] - v[2] / 2, v[2], v[2]].join(" "),
			);
		}
		const start = performance.now();
		function step(now: number) {
			const t = Math.min(1, (now - start) / duration);
			draw(t === 1 ? dest : tween(t * t * (3 - 2 * t)));
			if (t < 1) frame = requestAnimationFrame(step);
		}
		if (duration) frame = requestAnimationFrame(step);
		else draw(dest);
		return () => cancelAnimationFrame(frame);
	}, [focus]);
	const peers =
		picked === null
			? []
			: data.concepts
					.map((c, i) => ({ c, i }))
					.filter(
						({ c, i }) =>
							i !== focus.data.concept &&
							c.facets.some((f) => f.records.includes(picked)),
					);
	const up = () => {
		if (picked !== null) setPicked(null);
		else jump(focus.parent?.data.key ?? "root");
	};
	return (
		<section className={styles.field} aria-label="概念与记忆">
			<div className={styles.toolbar}>
				<div className={styles.tabs}>
					{(["reading", "archive"] as const).map((k) => (
						<button
							type="button"
							key={k}
							disabled={!data.concepts.some((c) => c.kind === k)}
							aria-pressed={kind === k}
							onClick={() => {
								setKind(k);
								jump("root");
							}}
						>
							{k === "reading" ? "记忆归纳" : "归档主题"}
						</button>
					))}
				</div>
				<button
					type="button"
					onClick={() => setLibrary(!library)}
					aria-label="搜索概念"
					aria-expanded={library}
				>
					<Search size={16} />
				</button>
			</div>
			{library && (
				<div className={styles.library}>
					<input
						aria-label="输入概念名称"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="搜索概念"
						onKeyDown={(e) => {
							if (e.key === "Escape") setLibrary(false);
						}}
					/>
					{data.concepts.map(
						(c, i) =>
							(c.name + " " + c.description)
								.toLowerCase()
								.includes(query.toLowerCase()) && (
								<button
									type="button"
									key={c.kind + c.name + c.description}
									onClick={() => select(i)}
								>
									{c.name}
									<ArrowRight size={13} />
								</button>
							),
					)}
					<button type="button" onClick={() => setLibrary(false)}>
						关闭
					</button>
				</div>
			)}
			<div className={styles.layout}>
				<div className={styles.plot}>
					<svg
						ref={canvas}
						viewBox="-10 -10 620 620"
						role="graphics-document"
						aria-label="可缩放的记忆圆图"
						onClick={up}
						onKeyDown={(e) => {
							if (e.key === "Escape") up();
						}}
					>
						{nodes.map((n) => {
							const direct = n.parent === focus;
							const act = () => {
								if (n.data.record !== undefined) setPicked(n.data.record);
								else jump(n.data.key);
							};
							return (
								<circle
									key={n.data.key}
									cx={n.x}
									cy={n.y}
									r={n.r}
									data-depth={n.depth}
									data-hot={direct}
									data-on={direct && n.data.record === picked}
									role={direct ? "button" : undefined}
									tabIndex={direct ? 0 : undefined}
									aria-label={direct ? n.data.name : undefined}
									aria-hidden={!direct}
									style={{ pointerEvents: direct ? "auto" : "none" }}
									onClick={(e) => {
										e.stopPropagation();
										act();
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											act();
										}
									}}
								>
									{direct && <title>{n.data.name}</title>}
								</circle>
							);
						})}
						{focus.children?.map((n) => {
							const font = Math.min(focus.r * 0.059, n.r * 0.32);
							const max = Math.max(
								3,
								Math.floor(
									(n.r * 1.65) /
										font /
										(/[^\p{ASCII}]/u.test(n.data.name) ? 1 : 0.58),
								),
							);
							const label =
								n.data.name.length > max
									? n.data.name.slice(0, max - 1) + "…"
									: n.data.name;
							return (
								<text
									key={n.data.key}
									x={n.x}
									y={n.y}
									fontSize={font}
									strokeWidth={font * 0.24}
								>
									{label}
								</text>
							);
						})}
					</svg>
				</div>
				<div className={styles.panel} aria-live="polite">
					{focus.depth > 0 && (
						<button type="button" className={styles.back} onClick={up}>
							<ChevronLeft size={14} />
							{picked !== null
								? "返回这个方面"
								: focus.depth === 1
									? "概念总览"
									: "返回概念"}
						</button>
					)}
					<h2>
						{record
							? "记忆原文"
							: (facet?.name ??
								concept?.name ??
								(kind === "reading" ? "从记忆形成的认识" : "归档中的主题"))}
					</h2>
					{record ? (
						<>
							<p>{record.text}</p>
							<details>
								<summary>原始出处</summary>
								{record.source}
							</details>
							{peers.length > 0 && (
								<div className={styles.peers}>
									<small>这条线索也参与</small>
									{peers.map(({ c, i }) => (
										<button
											type="button"
											key={i}
											onClick={() => select(i, picked ?? undefined)}
										>
											{c.name}
											<ArrowRight size={14} />
										</button>
									))}
								</div>
							)}
						</>
					) : facet ? (
						<p>
							{concept?.name} · {facet.records.length} 条记忆
						</p>
					) : concept ? (
						<p>{concept.description}</p>
					) : (
						<p>点进一个圆，看哪些记忆共同构成这项认识。</p>
					)}
				</div>
			</div>
		</section>
	);
}
