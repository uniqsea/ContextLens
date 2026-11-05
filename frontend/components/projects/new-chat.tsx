"use client";
import { SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { projectPath } from "@/lib/projects/types";

export function NewChat({
	scope,
	className,
}: {
	scope: string;
	className: string;
}) {
	const router = useRouter();
	const t = useTranslations();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	async function create() {
		setBusy(true);
		setFailed(false);
		try {
			const res = await fetch("/api/threads", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ metadata: { project_scope: scope } }),
			});
			if (!res.ok) throw new Error();
			const thread = await res.json();
			router.push(`${projectPath(scope)}/chat/${thread.thread_id}`);
		} catch {
			setFailed(true);
			setBusy(false);
		}
	}
	return (
		<>
			<button
				type="button"
				className={className}
				disabled={busy}
				onClick={create}
				title={t("lens.newChat")}
			>
				<SquarePen aria-hidden="true" />
				<span>{t("lens.newChat")}</span>
			</button>
			{failed && <span role="alert">{t("projects.failed")}</span>}
		</>
	);
}
