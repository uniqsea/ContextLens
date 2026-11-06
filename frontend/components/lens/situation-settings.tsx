"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	useDialogDismiss,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
	const { open, dismiss, onOpenChangeComplete } = useDialogDismiss(onClose);
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
			dismiss();
		} catch {
			setError(t("saveFailed"));
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => !next && dismiss()}
			onOpenChangeComplete={onOpenChangeComplete}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("situationsTitle")}</DialogTitle>
					<DialogDescription>{t("situationsBody")}</DialogDescription>
				</DialogHeader>
				<DialogBody className="lens-sections">
					<section>
						<h3>{t("situationsAsk")}</h3>
						<Textarea
							rows={3}
							value={description}
							placeholder={t("situationsAskHint")}
							aria-label={t("situationsAsk")}
							onChange={(e) => setDescription(e.target.value)}
						/>
						<div className="mt-2">
							<Button
								type="button"
								variant="secondary"
								disabled={!description.trim() || thinking}
								onClick={suggest}
							>
								{thinking ? t("situationsThinking") : t("situationsSuggest")}
							</Button>
						</div>
					</section>
					<section>
						<h3>{t("situationsMine")}</h3>
						<div className="lens-situation-rows">
							{rows.map((r) => (
								<div key={r.key} className="lens-situation">
									<Input
										type="text"
										value={r.name}
										placeholder={t("situationsName")}
										aria-label={t("situationsName")}
										onChange={(e) => edit(r.key, { name: e.target.value })}
									/>
									<Button
										type="button"
										variant="quiet"
										size="icon-sm"
										className="hover:text-destructive"
										aria-label={t("situationsRemove", { name: r.name })}
										onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
									>
										<X aria-hidden="true" />
									</Button>
									<Textarea
										rows={2}
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
						<div className="mt-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									setRows([
										...rows,
										{ key: nextKey, name: "", definition: "" },
									]);
									setNextKey(nextKey + 1);
								}}
							>
								{t("situationsAdd")}
							</Button>
						</div>
					</section>
					{error && <p role="alert">{error}</p>}
				</DialogBody>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={dismiss}>
						{t("close")}
					</Button>
					<Button
						type="button"
						variant="default"
						disabled={saving}
						onClick={save}
					>
						{saving ? t("saving") : t("save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
