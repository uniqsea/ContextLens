"use client";

import { Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { memoryApi } from "@/lib/memory-api";
import type { MemoryRecord, Scene, TimelineFact } from "@/lib/memory-types";
import { MemoryEditor } from "./editor";
import { useMemoryLabels } from "./memory-card";
import { Timeline } from "./timeline";

/** Two panels: on the left how this memory got here; on the right what it says and what can be done
 * to it. With no memory it is only the form on the right, for adding one. */
export function MemoryDetail({
	memory: m,
	scope,
	sceneOptions,
	refreshKey,
	error,
	onClose,
	onChange,
	onChanged,
}: {
	memory?: MemoryRecord;
	scope: string;
	sceneOptions: Scene[];
	refreshKey: number;
	error: string;
	onClose: () => void;
	/** Run a change, then reload; failures come back through `error`. */
	onChange: (change: () => Promise<unknown>) => void;
	onChanged: () => void;
}) {
	const t = useTranslations("library");
	const te = useTranslations("editor");
	const { type, source } = useMemoryLabels(m);
	const [editing, setEditing] = useState(!m);
	const [confirmPurge, setConfirmPurge] = useState(false);
	const [facts, setFacts] = useState<TimelineFact[]>([]);
	const id = m?.id;
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the reload trigger
	useEffect(() => {
		if (!id) return;
		let live = true;
		memoryApi
			.timeline(id)
			.then((list) => {
				if (live) setFacts(list);
			})
			.catch(() => {
				/* the change history below still shows */
			});
		return () => {
			live = false;
		};
	}, [id, refreshKey]);

	const trashed = m?.lifecycle_state === "trashed";
	/** A change that takes the memory out of this view. */
	const andClose = (change: () => Promise<unknown>) => {
		onChange(change);
		onClose();
	};
	const close = (
		<DialogClose className="lens-icon-btn" aria-label={t("close")}>
			<X aria-hidden="true" />
		</DialogClose>
	);
	return (
		<Dialog
			open
			disablePointerDismissal={editing}
			onOpenChange={(open, details) => {
				if (editing && details.reason === "escape-key") details.cancel();
				else if (!open) onClose();
			}}
		>
			<DialogContent
				className={`lens-theme lib-detail${m ? "" : " is-solo"}`}
				showCloseButton={false}
				aria-describedby={undefined}
			>
				{m && (
					<div className="lib-detail-main">
						<h3>{t("history")}</h3>
						{facts.length > 1 && (
							<ol className="lib-facts" aria-label={t("factTimeline")}>
								{facts.map((f) => (
									<li key={f.id} data-current={f.current}>
										<time>{f.created_at.slice(0, 10)}</time> {f.content}
									</li>
								))}
							</ol>
						)}
						<Timeline
							memoryId={m.id}
							refreshKey={refreshKey}
							onChanged={onChanged}
						/>
					</div>
				)}
				<aside className="lib-detail-side">
					{editing ? (
						<>
							<div className="lib-detail-head">
								<DialogTitle>{te(m ? "editTitle" : "addTitle")}</DialogTitle>
								{m ? null : close}
							</div>
							<MemoryEditor
								memory={m}
								scope={scope}
								sceneOptions={sceneOptions}
								onCancel={m ? () => setEditing(false) : onClose}
								onSaved={() => {
									onChanged();
									if (m) setEditing(false);
									else onClose();
								}}
							/>
						</>
					) : (
						m && (
							<>
								<div className="lib-detail-head">
									<DialogTitle>{m.title}</DialogTitle>
									{close}
								</div>
								<div className="lib-detail-scroll">
									<p className="lib-detail-text">{m.content}</p>
									<div className="lib-props">
										<div className="lib-prop">
											<span>{te("type")}</span>
											<span>{type}</span>
										</div>
										{m.scenes.length > 0 && (
											<div className="lib-prop">
												<span>{te("scenes")}</span>
												<span>{m.scenes.join(" · ")}</span>
											</div>
										)}
										{m.concepts.length > 0 && (
											<div className="lib-prop">
												<span>{te("concepts")}</span>
												<span>{m.concepts.map((c) => c.name).join(" · ")}</span>
											</div>
										)}
										{m.check_at && (
											<div className="lib-prop">
												<span>{t("checkLabel")}</span>
												<span className={m.due ? "lib-due" : undefined}>
													{m.due
														? t("maybeStale")
														: t("checkAt", { date: m.check_at })}
												</span>
											</div>
										)}
										<div className="lib-prop">
											<span>{t("sourceLabel")}</span>
											<span>{source}</span>
										</div>
										<div className="lib-prop">
											<span>{t("versionLabel")}</span>
											<span>v{m.revision}</span>
										</div>
										{!trashed && (
											<div className="lib-prop">
												<span id="lib-always-on">{t("alwaysOn")}</span>
												<Switch
													aria-labelledby="lib-always-on"
													checked={m.always_on}
													title={t(m.always_on ? "unpin" : "pin")}
													onCheckedChange={(checked) =>
														onChange(() => memoryApi.setAlwaysOn(m.id, checked))
													}
												/>
											</div>
										)}
									</div>
								</div>
								{error && (
									<p role="alert" className="lens-alert">
										{error}
									</p>
								)}
								<div className="lib-detail-foot">
									{confirmPurge ? (
										<div className="lib-confirm" role="alert">
											<p>{t("purgeConfirm")}</p>
											<div>
												<button
													type="button"
													className="lens-btn outline"
													onClick={() => setConfirmPurge(false)}
												>
													{t("cancel")}
												</button>
												<button
													type="button"
													className="lens-btn solid-danger"
													onClick={() => andClose(() => memoryApi.purge(m.id))}
												>
													{t("purgeYes")}
												</button>
											</div>
										</div>
									) : trashed ? (
										<>
											<button
												type="button"
												className="lens-btn danger block"
												onClick={() => setConfirmPurge(true)}
											>
												<X aria-hidden="true" />
												{t("purge")}
											</button>
											<button
												type="button"
												className="lens-btn primary block"
												onClick={() => andClose(() => memoryApi.restore(m.id))}
											>
												<RotateCcw aria-hidden="true" />
												{t("restore")}
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												className="lens-btn outline block"
												onClick={() => andClose(() => memoryApi.trash(m.id))}
											>
												<Trash2 aria-hidden="true" />
												{t("moveToTrash")}
											</button>
											<button
												type="button"
												className="lens-btn primary block"
												onClick={() => setEditing(true)}
											>
												<Pencil aria-hidden="true" />
												{t("edit")}
											</button>
										</>
									)}
								</div>
							</>
						)
					)}
				</aside>
			</DialogContent>
		</Dialog>
	);
}
