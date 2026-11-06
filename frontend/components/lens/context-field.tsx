"use client";

import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	type DragEvent,
	type ReactNode,
	useId,
	useMemo,
	useState,
} from "react";
import { InlineLoading } from "@/components/page-status";
import {
	Breadcrumb,
	DirectoryLink,
} from "@/components/projects/file-browser-controls";
import { FileIcon } from "@/components/projects/file-icon";
import { Button } from "@/components/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item";
import { SearchField } from "@/components/ui/search-field";
import type { Candidate } from "@/lib/lens/types";
import styles from "./context-field.module.css";

const MIME = "application/x-contextlens-source";

export function callable(c: Candidate) {
	return (
		(c.layer === "memory" || c.layer === "retrieval") && c.status !== "trashed"
	);
}

function acceptDrop(e: DragEvent) {
	if (e.dataTransfer.types.includes(MIME)) e.preventDefault();
}

function startDrag(e: DragEvent, id: string) {
	e.dataTransfer.effectAllowed = "move";
	e.dataTransfer.setData(MIME, id);
}

interface Directory {
	name: string;
	files: Candidate[];
	folders: Map<string, Directory>;
	count: number;
}

function directory(name: string): Directory {
	return { name, files: [], folders: new Map(), count: 0 };
}

function fileTree(files: Candidate[]) {
	let root = directory("");
	for (const file of files) {
		let parent = root;
		parent.count++;
		for (const part of file.title.split("/").slice(0, -1).filter(Boolean)) {
			const child = parent.folders.get(part) ?? directory(part);
			parent.folders.set(part, child);
			child.count++;
			parent = child;
		}
		parent.files.push(file);
	}
	// The shared project prefix belongs in the heading, once.
	if (!root.files.length && root.folders.size === 1)
		root = [...root.folders.values()][0];
	return root;
}

function DirectoryContents({
	node,
	renderFile,
}: {
	node: Directory;
	renderFile: (file: Candidate) => ReactNode;
}) {
	const t = useTranslations("field");
	const [path, navigate] = useState("");
	const parts = path.split("/").filter(Boolean);
	let current = node;
	const valid: string[] = [];
	for (const part of parts) {
		const child = current.folders.get(part);
		if (!child) break;
		current = child;
		valid.push(part);
	}
	const directory = valid.join("/");
	return (
		<>
			<Breadcrumb
				rootName={node.name || t("files")}
				directory={directory}
				navigate={navigate}
			/>
			{[...current.folders.keys()]
				.sort((a, b) => a.localeCompare(b))
				.map((name) => (
					<DirectoryLink
						key={name}
						name={name}
						onOpen={() => navigate([...valid, name].join("/"))}
					/>
				))}
			{current.files
				.slice()
				.sort((a, b) => a.title.localeCompare(b.title))
				.map(renderFile)}
		</>
	);
}

export function ContextField({
	candidates,
	query,
	order,
	onAdd,
	onHover,
	error,
	onRetry,
}: {
	candidates: Candidate[] | undefined;
	query: string;
	order: string[];
	onAdd: (id: string) => void;
	onHover: (ids: string[] | null) => void;
	error: boolean;
	onRetry: () => void;
}) {
	const t = useTranslations("field");

	const [filter, setFilter] = useState("");

	const all = useMemo(() => candidates?.filter(callable) ?? [], [candidates]);
	const groups = useMemo(() => {
		const match = filter.trim().toLocaleLowerCase();
		const visible = all.filter(
			(c) =>
				!match || `${c.title} ${c.content}`.toLocaleLowerCase().includes(match),
		);
		return [
			visible.filter((c) => c.layer === "memory"),
			visible.filter((c) => c.layer === "retrieval"),
		].filter((group) => group.length);
	}, [all, filter]);
	const tree = useMemo(
		() =>
			fileTree(groups.find((group) => group[0].layer === "retrieval") ?? []),
		[groups],
	);
	function renderCard(c: Candidate) {
		const chosen = order.includes(c.id);
		const score = c.always_on
			? t("always")
			: !query
				? null
				: c.layer === "memory" && c.relevance != null
					? t("score", { score: c.relevance.toFixed(2) })
					: c.retrieval_rank
						? t("rank", { n: c.retrieval_rank })
						: t("unmatched");
		return (
			<Item
				key={c.id}
				size="xs"
				variant={chosen ? "muted" : "default"}
				data-field-id={c.id}
				data-in-input={chosen}
				className="cursor-grab flex-nowrap hover:bg-muted [&.hl]:bg-muted"
				draggable
				onDragStart={(e) => startDrag(e, c.id)}
				onMouseEnter={() => onHover([c.id])}
				onMouseLeave={() => onHover(null)}
			>
				{c.layer === "retrieval" && (
					<ItemMedia>
						<FileIcon name={c.title.split("/").at(-1) ?? c.title} />
					</ItemMedia>
				)}
				<ItemContent className="min-w-0">
					<ItemTitle className="block max-w-full truncate" title={c.title}>
						{c.layer === "retrieval" ? c.title.split("/").pop() : c.title}
					</ItemTitle>
					{c.layer === "retrieval" && filter.trim() && (
						<ItemDescription>{c.title}</ItemDescription>
					)}
					{c.layer !== "retrieval" && (
						<ItemDescription>{c.content}</ItemDescription>
					)}
					{score && c.layer === "memory" && (
						<ItemDescription>{score}</ItemDescription>
					)}
				</ItemContent>
				<ItemActions>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={t(chosen ? "added" : "add", { title: c.title })}
						title={t(chosen ? "added" : "add", { title: c.title })}
						disabled={chosen}
						onClick={() => onAdd(c.id)}
					>
						{chosen ? <Check /> : <Plus />}
					</Button>
				</ItemActions>
			</Item>
		);
	}

	return (
		<aside className={styles.field} aria-label={t("title")}>
			<header className={styles.header}>
				<h2>{t("sources")}</h2>
			</header>
			{all.length > 0 && (
				<SearchField
					label={t("filter")}
					value={filter}
					onValueChange={setFilter}
					className="mx-2 mb-2.5 w-auto"
				/>
			)}
			<section
				aria-label={t("sources")}
				className={styles.canvas}
				data-library="true"
			>
				{error && (
					<p className={styles.empty}>
						{t("failed")}{" "}
						<button type="button" onClick={onRetry}>
							{t("retry")}
						</button>
					</p>
				)}
				{!error && !candidates && <InlineLoading label={t("loading")} />}
				{!error &&
					candidates &&
					(!groups.length ? (
						<p className={styles.empty}>
							{t(all.length ? "noMatch" : "empty")}
						</p>
					) : (
						groups.map((group) => (
							<section key={group[0].layer} className={styles.group}>
								<h3>
									{group[0].layer === "memory" ? t("memories") : t("files")}{" "}
									<span>{group.length}</span>
								</h3>
								<div className={styles.grid}>
									{group[0].layer === "retrieval" && tree && !filter.trim() ? (
										<DirectoryContents
											key={tree.name}
											node={tree}
											renderFile={renderCard}
										/>
									) : (
										group.map(renderCard)
									)}
								</div>
							</section>
						))
					))}
			</section>
		</aside>
	);
}

function SortableInputRow({
	id,
	name,
	onRemove,
	onDrop,
}: {
	id: string;
	name: string;
	onRemove: () => void;
	onDrop: (e: DragEvent<HTMLLIElement>) => void;
}) {
	const t = useTranslations("field");
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
	} = useSortable({ id });
	return (
		<li
			ref={setNodeRef}
			data-input-id={id}
			onDrop={onDrop}
			style={{ transform: CSS.Transform.toString(transform), transition }}
		>
			<Button
				variant="ghost"
				size="icon-xs"
				ref={setActivatorNodeRef}
				className="touch-none cursor-grab active:cursor-grabbing"
				{...attributes}
				{...listeners}
				aria-label={t("reorder", { title: name })}
				title={t("reorder", { title: name })}
			>
				<GripVertical />
			</Button>
			<span className={styles.name} title={name}>
				{name}
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={t("remove", { title: name })}
				onClick={onRemove}
			>
				<X />
			</Button>
		</li>
	);
}

export function OrderedInput({
	order,
	candidates,
	onAdd,
	onMove,
	onRemove,
}: {
	order: string[];
	candidates: Map<string, Candidate>;
	onAdd: (id: string, before?: string) => void;
	onMove: (id: string, before?: string) => void;
	onRemove: (id: string) => void;
}) {
	const t = useTranslations("field");
	const [over, setOver] = useState(false);
	const sortId = useId();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const drop = (e: DragEvent, before?: string) => {
		const id = e.dataTransfer.getData(MIME);
		if (!id || !candidates.has(id)) return;
		e.preventDefault();
		e.stopPropagation();
		setOver(false);
		onAdd(id, before);
	};
	return (
		<section
			className={styles.input}
			aria-label={t("input")}
			data-input-zone=""
			data-over={over}
			onDragOver={(e) => {
				acceptDrop(e);
				if (e.defaultPrevented) setOver(true);
			}}
			onDragLeave={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null))
					setOver(false);
			}}
			onDrop={(e) => drop(e)}
		>
			<strong>{t("input")}</strong>
			{order.length === 0 && <span>{t("drop")}</span>}
			{order.length > 0 && (
				<DndContext
					id={sortId}
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={({ active, over }) => {
						if (!over || active.id === over.id) return;
						const from = order.indexOf(String(active.id));
						const to = order.indexOf(String(over.id));
						if (from < 0 || to < 0) return;
						onMove(order[from], arrayMove(order, from, to)[to + 1]);
					}}
				>
					<SortableContext items={order} strategy={verticalListSortingStrategy}>
						<ol>
							{order.map((id, i) => (
								<SortableInputRow
									key={id}
									id={id}
									name={candidates.get(id)?.title ?? t("unavailable")}
									onRemove={() => onRemove(id)}
									onDrop={(e) => {
										const rect = e.currentTarget.getBoundingClientRect();
										drop(
											e,
											e.clientY < rect.top + rect.height / 2
												? id
												: order[i + 1],
										);
									}}
								/>
							))}
						</ol>
					</SortableContext>
				</DndContext>
			)}
		</section>
	);
}
