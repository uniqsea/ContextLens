"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MemoryApiError, memoryApi } from "@/lib/memory-api";
import type { ImportCandidate, MemoryEvent } from "@/lib/memory-types";

const RELATION = {
	new: "relationNew",
	same: "relationSame",
	replaces: "relationReplaces",
	conflicts: "relationConflicts",
} as const;

/** Paste what another assistant knows about the user, go through what was read from it, keep some.
 * Nothing is written before the last step, and what is written can be undone in one go. */
export function ImportDialog({
	scope,
	onClose,
	onChanged,
}: {
	scope: string;
	onClose: () => void;
	onChanged: () => void;
}) {
	const t = useTranslations("import");
	const [text, setText] = useState("");
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [found, setFound] = useState<{
		candidates: ImportCandidate[];
		degraded: boolean;
	}>();
	// Keys of the candidates to import; what is already here starts unticked.
	const [kept, setKept] = useState<Set<number>>(new Set());
	// The events written, and how many memories they brought in.
	const [written, setWritten] = useState<{
		events: MemoryEvent[];
		count: number;
	}>();
	const [undone, setUndone] = useState(false);

	const copy = async () => {
		await navigator.clipboard.writeText(t("prompt"));
		setCopied(true);
		setTimeout(() => setCopied(false), 1600);
	};

	const read = async () => {
		setBusy(true);
		setError("");
		try {
			const result = await memoryApi.importPreview(scope, text);
			setFound(result);
			setKept(
				new Set(
					result.candidates
						.filter((c) => c.relation === "new" || c.relation === "replaces")
						.map((c) => c.key),
				),
			);
		} catch (e) {
			setError(
				t("readFailed", {
					message: e instanceof MemoryApiError ? e.message : "",
				}),
			);
		} finally {
			setBusy(false);
		}
	};

	const edit = (key: number, change: Partial<ImportCandidate>) =>
		setFound(
			found && {
				...found,
				candidates: found.candidates.map((c) =>
					c.key === key ? { ...c, ...change } : c,
				),
			},
		);
	const today = new Date().toISOString().slice(0, 10);

	const toggle = (key: number) => {
		const next = new Set(kept);
		if (!next.delete(key)) next.add(key);
		setKept(next);
	};

	const commit = async () => {
		if (!found) return;
		setBusy(true);
		setError("");
		try {
			const items = found.candidates.filter(
				(c) => kept.has(c.key) && c.learned.trim(),
			);
			const events = await memoryApi.importCommit(scope, items);
			setWritten({ events, count: items.length });
			onChanged();
		} catch {
			setError(t("commitFailed"));
		} finally {
			setBusy(false);
		}
	};

	const undo = async () => {
		const first = written?.events[0];
		if (!first) return;
		setBusy(true);
		try {
			await memoryApi.revert(first.id);
			setUndone(true);
			onChanged();
		} catch {
			setError(t("commitFailed"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("title")}</DialogTitle>
					<DialogDescription>{t("body")}</DialogDescription>
				</DialogHeader>
				<DialogBody className="lens-sections">
					{written ? (
						<section className="lib-import-done" aria-live="polite">
							<p>
								{undone ? t("undone") : t("done", { count: written.count })}
							</p>
						</section>
					) : found ? (
						<section>
							{found.degraded && <p className="lib-hint">{t("degraded")}</p>}
							<h3>
								{found.candidates.length
									? t("review", { count: found.candidates.length })
									: t("nothing")}
							</h3>
							<ul className="lib-import-list">
								{found.candidates.map((c) => (
									<li key={c.key} data-off={!kept.has(c.key) || undefined}>
										<Checkbox
											className="mt-2.5 ml-1"
											checked={kept.has(c.key)}
											aria-label={t("keep")}
											onCheckedChange={() => toggle(c.key)}
										/>
										<div>
											<Textarea
												rows={1}
												value={c.learned}
												aria-label={t("text")}
												onChange={(e) =>
													edit(c.key, { learned: e.target.value })
												}
											/>
											<p>
												<input
													type="date"
													className="lib-import-date"
													value={c.noted ?? ""}
													max={today}
													title={t("noted")}
													aria-label={t("noted")}
													onChange={(e) =>
														edit(c.key, { noted: e.target.value || null })
													}
												/>
												<span
													className="lib-import-tag"
													data-relation={c.relation}
												>
													{t(RELATION[c.relation])}
												</span>
												{c.source === "inferred" && (
													<span className="lib-import-tag">
														{t("inferred")}
													</span>
												)}
												{c.existing &&
													t("existing", { text: c.existing.learned })}
											</p>
											{c.evidence && c.evidence !== c.learned && (
												<blockquote>{c.evidence}</blockquote>
											)}
										</div>
									</li>
								))}
							</ul>
						</section>
					) : (
						<>
							<section>
								<h3>{t("step1")}</h3>
								<div className="lib-import-prompt">
									<pre>{t("prompt")}</pre>
									<Button
										type="button"
										variant="secondary"
										className="absolute right-2 bottom-2"
										onClick={copy}
									>
										{copied ? (
											<Check aria-hidden="true" />
										) : (
											<Copy aria-hidden="true" />
										)}
										{copied ? t("copied") : t("copy")}
									</Button>
								</div>
							</section>
							<section>
								<h3>{t("step2")}</h3>
								<Textarea
									rows={8}
									value={text}
									placeholder={t("pasteHint")}
									aria-label={t("step2")}
									onChange={(e) => setText(e.target.value)}
								/>
							</section>
						</>
					)}
					{error && <p role="alert">{error}</p>}
				</DialogBody>
				<DialogFooter>
					{written ? (
						<>
							{!undone && written.events.length > 0 && (
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={undo}
								>
									{t("undo")}
								</Button>
							)}
							<Button type="button" variant="default" onClick={onClose}>
								{t("close")}
							</Button>
						</>
					) : found ? (
						<>
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => setFound(undefined)}
							>
								{t("back")}
							</Button>
							<Button
								type="button"
								variant="default"
								disabled={busy || kept.size === 0}
								onClick={commit}
							>
								{busy ? t("committing") : t("commit", { count: kept.size })}
							</Button>
						</>
					) : (
						<>
							<Button type="button" variant="outline" onClick={onClose}>
								{t("close")}
							</Button>
							<Button
								type="button"
								variant="default"
								disabled={busy || !text.trim()}
								onClick={read}
							>
								{busy ? t("reading") : t("read")}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
