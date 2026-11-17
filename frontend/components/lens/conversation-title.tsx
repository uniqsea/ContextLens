"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { renameConversation } from "@/lib/projects/conversations";
import styles from "./conversation-title.module.css";
import { Input } from "@/components/ui/input";

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
				<Hint label={displayed}>
					<h1 className={styles.title}>{displayed}</h1>
				</Hint>
				<Hint label={t("conversationTitle.rename")}>
					<Button
						ref={trigger}
						type="button"
						variant="quiet"
						size="icon-sm"
						aria-label={t("conversationTitle.rename")}
						onClick={() => setDraft(displayed)}
					>
						<Pencil aria-hidden="true" />
					</Button>
				</Hint>
			</div>
		);
	}
	return (
		<>
			<form className={styles.row} onSubmit={save}>
				<Input
					ref={input}
					className={`${styles.input} h-8 flex-1 rounded-full`}
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
				<Hint label={t("conversationTitle.save")}>
					<Button
						type="submit"
						variant="quiet"
						size="icon-sm"
						disabled={saving || !draft.trim()}
						aria-label={t("conversationTitle.save")}
					>
						<Check aria-hidden="true" />
					</Button>
				</Hint>
				<Hint label={t("conversationTitle.cancel")}>
					<Button
						type="button"
						variant="quiet"
						size="icon-sm"
						disabled={saving}
						aria-label={t("conversationTitle.cancel")}
						onClick={close}
					>
						<X aria-hidden="true" />
					</Button>
				</Hint>
			</form>
			{failed && (
				<p className={styles.error} role="alert">
					{t("conversationTitle.failed")}
				</p>
			)}
		</>
	);
}
