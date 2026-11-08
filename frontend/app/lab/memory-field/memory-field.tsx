"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
	Orbit,
	WholeWord,
	Quote,
	BookOpen,
	Fingerprint,
	Search,
	ArrowLeft,
	ArrowRight,
	Minus,
	Plus,
	Scan,
	MapPin,
	ChevronLeft,
	ChevronRight,
	X,
	Network,
} from "lucide-react";
import ConceptField from "./concept-field";
import styles from "./memory-field.module.css";

type Entry = { title: string; source: string; text: string };
type Link = { record: number; reason: string; cue?: string };
type Context = {
	title: string;
	focus?: number;
	source?: string;
	links: Link[];
};
type Dataset = { records: Entry[]; contexts: Context[] };

function MemoryLabel({ text, cue }: { text: string; cue?: string }) {
	if (!cue) return <>{text}</>;
	const at = text.toLowerCase().indexOf(cue.toLowerCase());
	if (at < 0) return <>{text}</>;
	const start = Math.max(0, at - 16);
	const end = Math.min(text.length, at + cue.length + 32);
	return (
		<>
			{start > 0 ? "…" : ""}
			{text.slice(start, at)}
			<mark>{text.slice(at, at + cue.length)}</mark>
			{text.slice(at + cue.length, end)}
			{end < text.length ? "…" : ""}
		</>
	);
}

export default function MemoryField() {
	const [source, setSource] = useState("personal");
	return (
		<main lang="zh-CN" className={styles.page}>
			<header>
				<i>
					<Orbit size={20} />
				</i>{" "}
				ContextLens <span>/</span> 记忆实验室
			</header>
			<div className={styles.bar}>
				<h1>记忆场</h1>
				<div className={styles.switcher} aria-label="数据来源">
					{[
						["personal", "我的记忆"],
						["locomo", "LoCoMo 基准"],
					].map(([key, label]) => (
						<button
							key={key}
							aria-pressed={key === source}
							onClick={() => setSource(key)}
						>
							{key === "personal" ? (
								<Fingerprint size={16} />
							) : (
								<BookOpen size={16} />
							)}{" "}
							{label}
						</button>
					))}
				</div>
			</div>
			{source === "personal" ? (
				<ConceptField />
			) : (
				<Field key={source} source={source} />
			)}
		</main>
	);
}

function Field({ source }: { source: string }) {
	const [data, setData] = useState<Dataset>();
	const [failed, setFailed] = useState(false);
	const [contextIndex, setContextIndex] = useState(0);
	const [selected, setSelected] = useState<number | null>(null);
	const [trail, setTrail] = useState<
		{ index: number; record: number | null; group: number }[]
	>([]);
	const [search, setSearch] = useState(false);
	const [resultLimit, setResultLimit] = useState(100);
	const field = useRef<HTMLElement>(null);
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState(0);
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const drag = useRef<{ x: number; y: number } | null>(null);
	const [reading, setReading] = useState(false);
	const personal = source === "personal";
	useEffect(() => {
		const controller = new AbortController();
		fetch("/api/lab/memory-field?source=" + source, {
			headers: { "x-memory-field": "inspect" },
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (res) => {
				if (!res.ok) throw Error();
				return (await res.json()) as Dataset;
			})
			.then(setData)
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [source]);
	if (!data)
		return (
			<p role="status">
				{failed ? "读取失败，请检查本地数据和开发服务。" : "正在读取本地数据…"}
			</p>
		);
	const context = data.contexts[contextIndex];
	if (!context) return <p>这个来源暂时没有可查看的情境。</p>;
	const focus =
		context.focus === undefined ? undefined : data.records[context.focus];
	const link = context.links.find((l) => l.record === selected);
	const entry = link ? data.records[link.record] : focus;
	const links = context.links.slice(group * 8, group * 8 + 8);
	const positions = links.map((_, i) => {
		const angle = (i * Math.PI * 2) / links.length - 1.92;
		return { x: 50 + 36 * Math.cos(angle), y: 47 + 33 * Math.sin(angle) };
	});
	const point = positions[links.findIndex((item) => item.record === selected)];
	const nextFocus =
		selected === null
			? -1
			: data.contexts.findIndex((c) => c.focus === selected);
	function resetView() {
		setZoom(1);
		setPan({ x: 0, y: 0 });
	}
	function visit(index: number, back = false) {
		if (index !== contextIndex)
			setTrail(
				back
					? trail.slice(0, -1)
					: [...trail, { index: contextIndex, record: selected, group }],
			);
		setContextIndex(index);
		setSelected(back ? trail[trail.length - 1].record : null);
		setGroup(back ? trail[trail.length - 1].group : 0);
		setSearch(false);
		setQuery("");
		setResultLimit(100);
		setReading(false);
		if (window.matchMedia("(max-width: 760px)").matches)
			field.current?.scrollIntoView({ block: "start" });
		resetView();
	}
	function follow() {
		if (!data || nextFocus < 0) return;
		visit(nextFocus);
	}
	function recall(record: number | null) {
		setReading(false);
		setSelected(record);
	}
	const target = link ? data.records[link.record] : undefined;
	function cycle(step: number) {
		const index = context.links.findIndex((item) => item.record === selected);
		const next = (index + step + context.links.length) % context.links.length;
		setGroup(Math.floor(next / 8));
		recall(context.links[next].record);
	}

	const results = !search
		? []
		: data.contexts
				.map((item, index) => ({ item, index }))
				.filter(({ item }) =>
					(item.title + " " + (item.source ?? ""))
						.toLowerCase()
						.includes(query.trim().toLowerCase()),
				);
	return (
		<>
			<div className={styles.workspace}>
				<section
					ref={field}
					className={styles.field}
					aria-label="记忆关系图"
					onPointerDown={(e) => {
						if (
							e.button !== 0 ||
							(e.target as Element).closest("button,input,dialog")
						)
							return;
						drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
						e.currentTarget.setPointerCapture(e.pointerId);
					}}
					onPointerMove={(e) => {
						if (drag.current)
							setPan({
								x: e.clientX - drag.current.x,
								y: e.clientY - drag.current.y,
							});
					}}
					onLostPointerCapture={() => {
						drag.current = null;
					}}
				>
					<div className={styles.topbar}>
						<button
							aria-label={personal ? "查找记忆" : "查找问题"}
							title={personal ? "查找记忆" : "查找问题"}
							onClick={() => setSearch(true)}
						>
							<Search size={17} />
						</button>
						<button
							disabled={!trail.length}
							aria-label="回到上一个焦点"
							onClick={() => visit(trail[trail.length - 1].index, true)}
						>
							<ArrowLeft size={16} />
						</button>
						{!link && (
							<button
								aria-label="查看当前焦点"
								title="查看当前焦点"
								onClick={() => setReading(true)}
							>
								<BookOpen size={17} />
							</button>
						)}
					</div>
					<div
						className={styles.space}
						data-personal={personal}
						data-recalling={!!link}
						style={{
							transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
						}}
					>
						<svg
							viewBox="0 0 100 100"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							{positions.map((p, i) => (
								<path
									key={links[i].record}
									data-active={links[i].record === selected}
									d={`M 50 47 Q ${(50 + p.x) / 2 + (47 - p.y) * 0.16} ${(47 + p.y) / 2 + (p.x - 50) * 0.12} ${p.x} ${p.y}`}
								/>
							))}
						</svg>
						<button
							aria-label={context.title}
							className={styles.core}
							aria-pressed={selected === null}
							onClick={() =>
								selected !== null
									? recall(null)
									: links.length
										? recall(links[0].record)
										: setReading(true)
							}
						>
							<Rosette seed={context.focus ?? contextIndex} central />
							<b>
								<MemoryLabel text={context.title} cue={link?.cue} />
							</b>
						</button>
						{links.map((l, i) => (
							<button
								key={l.record}
								className={styles.node}
								style={{
									left: positions[i].x + "%",
									top: positions[i].y + "%",
								}}
								aria-pressed={selected === l.record}
								aria-label={data.records[l.record].title}
								onClick={() => recall(selected === l.record ? null : l.record)}
							>
								<Rosette seed={l.record} />
								<b>
									<MemoryLabel
										text={data.records[l.record].title}
										cue={selected === l.record ? l.cue : undefined}
									/>
								</b>
							</button>
						))}
						{link && target && point && (
							<div
								className={styles.clues}
								aria-label="联想线索"
								key={link.record}
								style={{
									left:
										50 + (point.x - 50) * 0.53 + (47 - point.y) * 0.08 + "%",
									top: 47 + (point.y - 47) * 0.53 + (point.x - 50) * 0.06 + "%",
								}}
							>
								{personal && (
									<span className={styles.wordCue} title={link.reason}>
										<WholeWord size={15} />
										<b>{link.cue}</b>
									</span>
								)}
								{!personal && (
									<span className={styles.wordCue}>
										<Quote size={17} />
										<small>标注证据</small>
										<b>{target.title.split("·").pop()?.trim()}</b>
									</span>
								)}
							</div>
						)}
					</div>
					{link ? (
						<div className={styles.recallNav}>
							<button onClick={() => recall(null)} aria-label="返回关系图">
								<X size={16} />
							</button>
							{context.links.length > 1 && (
								<>
									<button onClick={() => cycle(-1)} aria-label="上一条联想">
										<ChevronLeft size={16} />
									</button>
									<span>
										{context.links.indexOf(link) + 1} / {context.links.length}
									</span>
									<button onClick={() => cycle(1)} aria-label="下一条联想">
										<ChevronRight size={16} />
									</button>
								</>
							)}
							<button
								onClick={() => setReading(true)}
								aria-label="查看原文"
								title="查看原文"
							>
								<BookOpen size={16} />
							</button>
							{nextFocus >= 0 && (
								<button onClick={follow}>
									从这里探索 <ArrowRight size={14} />
								</button>
							)}
						</div>
					) : (
						<div className={styles.bottom}>
							<div>
								<button
									aria-label="缩小"
									disabled={zoom <= 0.6}
									onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
								>
									<Minus size={15} />
								</button>
								<button aria-label="恢复视图" onClick={resetView}>
									<Scan size={15} />
								</button>
								<button
									aria-label="放大"
									disabled={zoom >= 2}
									onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
								>
									<Plus size={15} />
								</button>
							</div>
						</div>
					)}
					{!link && context.links.length > 8 && (
						<div className={styles.pager}>
							<button
								disabled={!group}
								aria-label="上一组证据"
								onClick={() => {
									setGroup(group - 1);
									setSelected(null);
								}}
							>
								<ChevronLeft />
							</button>
							{group + 1} / {Math.ceil(context.links.length / 8)}
							<button
								disabled={(group + 1) * 8 >= context.links.length}
								aria-label="下一组证据"
								onClick={() => {
									setGroup(group + 1);
									setSelected(null);
								}}
							>
								<ChevronRight />
							</button>
						</div>
					)}
				</section>
				{reading && (
					<Panel label="阅读面板" close={() => setReading(false)}>
						<article className={styles.detail}>
							<button
								className={styles.close}
								aria-label="关闭详情"
								onClick={() => setReading(false)}
							>
								<X size={18} />
							</button>
							<small>
								<MapPin size={14} />
								{link
									? personal
										? "相关记忆"
										: "标注证据"
									: personal
										? "当前焦点"
										: "基准问题"}
							</small>
							<h2>{personal ? "记忆原文" : (entry?.title ?? context.title)}</h2>
							<code>{entry?.source ?? context.source}</code>
							{link && (
								<div className={styles.reason}>
									<strong>
										<Network size={14} />
										关联依据
									</strong>
									{link.reason}
								</div>
							)}
							{nextFocus >= 0 && nextFocus !== contextIndex && (
								<button className={styles.explore} onClick={() => follow()}>
									以此为中心探索 <ArrowRight size={16} />
								</button>
							)}
							<details open key={selected ?? "core"}>
								<summary>{entry ? "查看原文" : "对话证据"}</summary>
								{entry ? (
									<div className={styles.body}>{entry.text}</div>
								) : (
									context.links.map((l, i) => (
										<button
											className={styles.evidence}
											key={l.record}
											onClick={() => {
												setGroup(Math.floor(i / 8));
												recall(l.record);
											}}
										>
											{data.records[l.record].title}
											<ChevronRight size={14} />
										</button>
									))
								)}
							</details>
						</article>
					</Panel>
				)}
			</div>
			{search && (
				<Panel label="查找焦点" close={() => setSearch(false)}>
					<div className={styles.search}>
						<Search size={18} />
						<input
							aria-label="搜索焦点"
							placeholder={personal ? "搜索记忆内容…" : "搜索基准问题…"}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setResultLimit(100);
							}}
						/>
						<button aria-label="关闭搜索" onClick={() => setSearch(false)}>
							<X size={18} />
						</button>
					</div>
					<div className={styles.results}>
						{results.length === 0 && <p>没有匹配结果</p>}
						{results.slice(0, resultLimit).map(({ item, index }) => (
							<button key={index} onClick={() => visit(index)}>
								{item.title}
								<ArrowRight size={14} />
							</button>
						))}
						{resultLimit < results.length && (
							<button onClick={() => setResultLimit(resultLimit + 100)}>
								显示更多结果
							</button>
						)}
					</div>
					<small>{results.length} 项结果</small>
				</Panel>
			)}
		</>
	);
}

function Panel({
	label,
	children,
	close,
}: {
	label: string;
	children: React.ReactNode;
	close: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const el = dialog.current;
		el?.showModal();
		return () => el?.close();
	}, []);
	return (
		<dialog
			className={styles.dialog}
			ref={dialog}
			aria-label={label}
			onCancel={close}
			onClick={(e) => {
				if (e.target === dialog.current) close();
			}}
		>
			<div>{children}</div>
		</dialog>
	);
}

// A stable line drawing lets the same record be recognized after changing focus.
const Rosette = memo(function Rosette({
	seed,
	central = false,
}: {
	seed: number;
	central?: boolean;
}) {
	if (central) {
		return (
			<svg className={styles.flower} viewBox="0 0 120 120" aria-hidden="true">
				<path d="M60 23 C75 4 98 18 94 38 C117 44 116 70 96 78 C102 100 78 115 61 97 C45 115 20 104 24 81 C2 75 2 49 24 40 C17 19 44 5 60 23 Z" />
				<circle cx="60" cy="60" r="8" fill="#fff2df" />
			</svg>
		);
	}
	const petals = 4 + (seed % 5);
	const ink = ["#426fbe", "#8072bf", "#308778", "#ca7932", "#aa5e94"][seed % 5];
	const paths = Array.from({ length: 24 }, (_, layer) => {
		const t = layer / 23;
		return (
			Array.from({ length: 193 }, (_, step) => {
				const a = (step * Math.PI) / 96;
				const wave = (1 + Math.cos(petals * a + t * 2.65)) / 2;
				const radius = 7 + 30 * t + (7 + 10 * t) * wave;
				const x = 60 + radius * Math.cos(a),
					y = 60 + radius * Math.sin(a);
				return (step === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
			}).join(" ") + "Z"
		);
	});
	return (
		<svg
			className={styles.flower}
			viewBox="0 0 120 120"
			aria-hidden="true"
			style={{ color: ink, rotate: (seed % 12) * 13 + "deg" }}
		>
			{paths.map((d, i) => (
				<path key={i} d={d} />
			))}
		</svg>
	);
});
