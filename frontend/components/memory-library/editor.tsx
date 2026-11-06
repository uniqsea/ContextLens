"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
					<Label>
						{t("title")}
						<Input
							required
							value={title}
							onChange={(e) => setTitle(e.target.value)}
						/>
					</Label>
					<Label>
						{t("content")}
						<Textarea
							required
							maxLength={20000}
							rows={5}
							value={content}
							onChange={(e) => setContent(e.target.value)}
						/>
					</Label>
					<FieldSet>
						<FieldLegend variant="label">{t("type")}</FieldLegend>
						<ToggleGroup
							variant="segment"
							spacing={0.5}
							value={[type]}
							onValueChange={(next) =>
								next[0] && setType(next[0] as typeof type)
							}
						>
							{TYPES.map((m) => (
								<ToggleGroupItem key={m} value={m}>
									{tl(`memoryTypes.${m}`)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</FieldSet>
					{sceneOptions.length > 0 && (
						<FieldSet>
							<FieldLegend variant="label">{t("scenes")}</FieldLegend>
							<div className="flex flex-wrap gap-1.5">
								{sceneOptions.map((s) => (
									<Button
										key={s.id}
										type="button"
										aria-pressed={scenes.includes(s.name)}
										variant="secondary"
										size="sm"
										onClick={() =>
											setScenes(
												scenes.includes(s.name)
													? scenes.filter((x) => x !== s.name)
													: [...scenes, s.name],
											)
										}
									>
										{s.name}
									</Button>
								))}
							</div>
						</FieldSet>
					)}
					<Label>
						{t("concepts")}
						<Input
							value={concepts}
							placeholder={t("conceptsHint")}
							onChange={(e) => setConcepts(e.target.value)}
						/>
					</Label>
					<p className="lib-hint">{t("hint")}</p>
					{error && <Alert variant="destructive">{error}</Alert>}
				</div>
			</div>
			<div className="lib-detail-foot">
				<Button
					disabled={busy}
					type="button"
					onClick={onCancel}
					variant="outline"
					className="w-full"
				>
					{t("cancel")}
				</Button>
				<Button
					disabled={busy}
					type="submit"
					variant="default"
					className="w-full"
				>
					{busy ? t("saving") : t("save")}
				</Button>
			</div>
		</form>
	);
}
