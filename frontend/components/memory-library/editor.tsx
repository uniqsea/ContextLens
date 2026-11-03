"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MemoryApiError, memoryApi } from "@/lib/memory-api";
import type { MemoryRecord, MemoryType, Scene } from "@/lib/memory-types";

const TYPES: MemoryType[] = ["semantic", "episodic", "procedural"];

/** Add a memory or edit one. An edit is a new version; the old one stays in the history. */
export function MemoryEditor({
	memory,
	scope,
	sceneOptions,
	onSaved,
	onCancel,
}: {
	memory?: MemoryRecord;
	scope: string;
	sceneOptions: Scene[];
	onSaved: () => void;
	onCancel: () => void;
}) {
	const t = useTranslations("editor");
	const tl = useTranslations("library");
	const [title, setTitle] = useState(memory?.title ?? "");
	const [content, setContent] = useState(memory?.content ?? "");
	const [type, setType] = useState<MemoryType>(
		memory?.memory_type ?? "semantic",
	);
	const [scenes, setScenes] = useState<string[]>(memory?.scenes ?? []);
	const [concepts, setConcepts] = useState(
		memory?.concepts.map((c) => c.name).join(", ") ?? "",
	);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const save = async () => {
		setBusy(true);
		setError("");
		const fields = {
			title,
			content,
			memory_type: type,
			scenes,
			concepts: concepts
				.split(/[,，、]/)
				.map((c) => c.trim())
				.filter(Boolean),
		};
		try {
			if (memory) await memoryApi.revise(memory.id, memory.revision, fields);
			else await memoryApi.create(scope, fields);
			onSaved();
		} catch (e) {
			setError(
				e instanceof MemoryApiError && e.status === 409
					? t("conflict")
					: e instanceof MemoryApiError && e.message
						? e.message
						: t("saveFailed"),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className="lib-editor"
			onSubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<div className="lib-detail-scroll">
				<div className="lib-editor-fields">
					<label className="lens-field">
						{t("title")}
						<input
							required
							className="lens-input"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
						/>
					</label>
					<label className="lens-field">
						{t("content")}
						<textarea
							required
							maxLength={20000}
							rows={5}
							className="lens-input"
							value={content}
							onChange={(e) => setContent(e.target.value)}
						/>
					</label>
					{/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form section */}
					<div className="lens-field" role="group" aria-label={t("type")}>
						{t("type")}
						<div>
							<div className="lens-seg">
								{TYPES.map((m) => (
									<button
										key={m}
										type="button"
										aria-pressed={type === m}
										onClick={() => setType(m)}
									>
										{tl(`memoryTypes.${m}`)}
									</button>
								))}
							</div>
						</div>
					</div>
					{sceneOptions.length > 0 && (
						// biome-ignore lint/a11y/useSemanticElements: a set of toggles, not a form section
						<div className="lens-field" role="group" aria-label={t("scenes")}>
							{t("scenes")}
							<div className="lens-chips">
								{sceneOptions.map((s) => (
									<button
										key={s.id}
										type="button"
										aria-pressed={scenes.includes(s.name)}
										className="lens-chip lib-toggle"
										onClick={() =>
											setScenes(
												scenes.includes(s.name)
													? scenes.filter((x) => x !== s.name)
													: [...scenes, s.name],
											)
										}
									>
										{s.name}
									</button>
								))}
							</div>
						</div>
					)}
					<label className="lens-field">
						{t("concepts")}
						<input
							className="lens-input"
							value={concepts}
							placeholder={t("conceptsHint")}
							onChange={(e) => setConcepts(e.target.value)}
						/>
					</label>
					<p className="lib-hint">{t("hint")}</p>
					{error && (
						<p role="alert" className="lens-alert">
							{error}
						</p>
					)}
				</div>
			</div>
			<div className="lib-detail-foot">
				<button
					disabled={busy}
					type="button"
					onClick={onCancel}
					className="lens-btn outline block"
				>
					{t("cancel")}
				</button>
				<button
					disabled={busy}
					type="submit"
					className="lens-btn primary block"
				>
					{busy ? t("saving") : t("save")}
				</button>
			</div>
		</form>
	);
}
