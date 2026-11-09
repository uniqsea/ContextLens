"use client";
import { Plus, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { projectPath } from "@/lib/projects/types";

export function NewChat({
	scope,
	compact = false,
}: {
	scope: string;
	compact?: boolean;
}) {
	const router = useRouter();
	const t = useTranslations();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	async function create() {
		setBusy(true);
		setFailed(false);
		try {
			const res = await fetch("/api/lens/conversations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ scope }),
			});
			if (!res.ok) throw new Error();
			const conversation = await res.json();
			router.push(`${projectPath(scope)}/chat/${conversation.id}`);
		} catch {
			setFailed(true);
			setBusy(false);
		}
	}
	return (
		<>
			<Button
				type="button"
				variant={compact ? "quiet" : "default"}
				size={compact ? "icon" : "default"}
				disabled={busy}
				onClick={create}
				title={t("lens.newChat")}
			>
				{compact ? (
					<Plus aria-hidden="true" />
				) : (
					<SquarePen aria-hidden="true" />
				)}
				<span className={compact ? "sr-only" : undefined}>
					{t("lens.newChat")}
				</span>
			</Button>
			{failed && <span role="alert">{t("projects.failed")}</span>}
		</>
	);
}
