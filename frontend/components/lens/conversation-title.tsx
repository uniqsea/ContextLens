"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { renameConversation } from "@/lib/projects/conversations";
import styles from "./conversation-title.module.css";

export function ConversationTitle({
	threadId,
	title,
}: {
	threadId: string;
	title: string;
}) {
	const t = useTranslations();
	const router = useRouter();
	const [saved, setSaved] = useState<string>();
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const displayed = saved ?? (title || t("lens.newChat"));
	const editing = draft !== null;

	useEffect(() => {
		if (editing) {
			input.current?.focus();
			input.current?.select();
		}
	}, [editing]);

	function close() {
		setDraft(null);
		setFailed(false);
		requestAnimationFrame(() => trigger.current?.focus());
	}

	async function save(event: FormEvent) {
		event.preventDefault();
		const next = draft?.trim();
		if (!next || saving) return;
		setSaving(true);
		setFailed(false);
		try {
			await renameConversation(threadId, next);
			setSaved(next);
			close();
			router.refresh();
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	}

	if (draft === null) {
		return (
			<div className={styles.row}>
				<h1 className={styles.title} title={displayed}>
					{displayed}
				</h1>
				<Button
					ref={trigger}
					type="button"
					variant="quiet"
					size="icon-sm"
					aria-label={t("conversationTitle.rename")}
					title={t("conversationTitle.rename")}
					onClick={() => setDraft(displayed)}
				>
					<Pencil aria-hidden="true" />
				</Button>
			</div>
		);
	}
	return (
		<>
			<form className={styles.row} onSubmit={save}>
				<input
					ref={input}
					className={styles.input}
					aria-label={t("conversationTitle.label")}
					value={draft}
					disabled={saving}
					maxLength={100}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape" && !event.nativeEvent.isComposing)
							close();
					}}
				/>
				<Button
					type="submit"
					variant="quiet"
					size="icon-sm"
					disabled={saving || !draft.trim()}
					aria-label={t("conversationTitle.save")}
					title={t("conversationTitle.save")}
				>
					<Check aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="quiet"
					size="icon-sm"
					disabled={saving}
					aria-label={t("conversationTitle.cancel")}
					title={t("conversationTitle.cancel")}
					onClick={close}
				>
					<X aria-hidden="true" />
				</Button>
			</form>
			{failed && (
				<p className={styles.error} role="alert">
					{t("conversationTitle.failed")}
				</p>
			)}
		</>
	);
}
