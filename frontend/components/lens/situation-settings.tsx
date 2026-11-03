"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { memoryApi } from "@/lib/memory-api";
import type { Scene } from "@/lib/memory-types";

type Row = {
	key: number;
	id?: string;
	name: string;
	definition: string;
	reason?: string;
};

/** The user's own broad situations, with what each means: edited by hand, or suggested by the AI from
 * how they say they use it. Nothing changes until they save. */
export function SituationSettings({
	current,
	onClose,
	onSaved,
}: {
	current: Scene[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const t = useTranslations("lens");
	const [rows, setRows] = useState<Row[]>(
		current.map((s, key) => ({
			key,
			id: s.id,
			name: s.name,
			definition: s.definition,
		})),
	);
	const [nextKey, setNextKey] = useState(current.length);
	const [description, setDescription] = useState("");
	const [thinking, setThinking] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	const edit = (key: number, change: Partial<Row>) =>
		setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

	const suggest = async () => {
		setThinking(true);
		setError("");
		try {
			const named = rows.filter((r) => r.name.trim());
			const found = await memoryApi.suggestSituations(
				description,
				named.map(({ name, definition }) => ({ name, definition })),
			);
			setRows(
				found.map((s, i) => ({
					...s,
					key: nextKey + i,
					id: named.find((r) => r.name.trim() === s.name)?.id,
				})),
			);
			setNextKey(nextKey + found.length);
		} catch {
			setError(t("situationsFailed"));
		} finally {
			setThinking(false);
		}
	};

	const save = async () => {
		const kept = rows.filter((r) => r.name.trim());
		if (new Set(kept.map((r) => r.name.trim())).size < kept.length) {
			setError(t("situationsDuplicate"));
			return;
		}
		setSaving(true);
		setError("");
		try {
			await memoryApi.saveScenes(
				kept.map(({ id, name, definition }) => ({ id, name, definition })),
			);
			onSaved();
			onClose();
		} catch {
			setError(t("saveFailed"));
			setSaving(false);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="lens-theme lens-dialog sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("situationsTitle")}</DialogTitle>
					<DialogDescription>{t("situationsBody")}</DialogDescription>
				</DialogHeader>
				<div className="lens-situations">
					<section>
						<h3>{t("situationsAsk")}</h3>
						<textarea
							rows={3}
							className="lens-input"
							value={description}
							placeholder={t("situationsAskHint")}
							aria-label={t("situationsAsk")}
							onChange={(e) => setDescription(e.target.value)}
						/>
						<div className="lens-situations-row">
							<button
								type="button"
								className="lens-btn"
								disabled={!description.trim() || thinking}
								onClick={suggest}
							>
								{thinking ? t("situationsThinking") : t("situationsSuggest")}
							</button>
						</div>
					</section>
					<section>
						<h3>{t("situationsMine")}</h3>
						<div className="lens-situation-rows">
							{rows.map((r) => (
								<div key={r.key} className="lens-situation">
									<input
										type="text"
										className="lens-input"
										value={r.name}
										placeholder={t("situationsName")}
										aria-label={t("situationsName")}
										onChange={(e) => edit(r.key, { name: e.target.value })}
									/>
									<button
										type="button"
										className="lens-icon-btn is-danger"
										aria-label={t("situationsRemove", { name: r.name })}
										onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
									>
										<X aria-hidden="true" />
									</button>
									<textarea
										rows={2}
										className="lens-input"
										value={r.definition}
										placeholder={t("situationsDefinition")}
										aria-label={t("situationsDefinitionOf", { name: r.name })}
										onChange={(e) =>
											edit(r.key, { definition: e.target.value })
										}
									/>
									{r.reason && <p>{r.reason}</p>}
								</div>
							))}
						</div>
						<div className="lens-situations-row">
							<button
								type="button"
								className="lens-btn"
								onClick={() => {
									setRows([
										...rows,
										{ key: nextKey, name: "", definition: "" },
									]);
									setNextKey(nextKey + 1);
								}}
							>
								{t("situationsAdd")}
							</button>
						</div>
					</section>
					{error && <p role="alert">{error}</p>}
					<div className="lens-situations-foot">
						<button
							type="button"
							className="lens-btn outline"
							onClick={onClose}
						>
							{t("close")}
						</button>
						<button
							type="button"
							className="lens-btn primary"
							disabled={saving}
							onClick={save}
						>
							{saving ? t("saving") : t("save")}
						</button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
