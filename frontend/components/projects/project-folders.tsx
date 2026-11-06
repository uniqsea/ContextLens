import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { folderApi, type ProjectFolder } from "@/lib/projects/folders";

import { FolderContents } from "./folder-contents";

export function ProjectFolders({
	project,
	list,
}: {
	project: string;
	list: boolean;
}) {
	const t = useTranslations("projectFiles");
	const [folders, setFolders] = useState<ProjectFolder[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<"" | "failed">("");
	const [revision, setRevision] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: revision retries a failed load
	useEffect(() => {
		const controller = new AbortController();
		setError("");
		folderApi
			.list(project, controller.signal)
			.then((result) => {
				if (!controller.signal.aborted) setFolders(result);
			})
			.catch(() => {
				if (!controller.signal.aborted) setError("failed");
			});
		return () => controller.abort();
	}, [project, revision]);

	async function removeFolder(id: string) {
		setBusy(true);
		setError("");
		try {
			setFolders(await folderApi.remove(project, id));
		} catch {
			setError("failed");
		} finally {
			setBusy(false);
		}
	}
	return (
		<section
			aria-label={t("tab")}
			className={list ? "max-w-[680px]" : undefined}
		>
			{folders?.length === 0 && (
				<p className="mt-1.5 text-muted-foreground">{t("hint")}</p>
			)}
			{folders && (
				<ul className="mt-2 divide-y divide-border">
					{folders.map((f) => (
						<FolderContents
							key={f.id}
							project={project}
							folder={f}
							list={list}
							busy={busy}
							onRemove={() => removeFolder(f.id)}
						/>
					))}
				</ul>
			)}
			{error && (
				<p role="alert" className="mt-3 text-[13px] text-destructive">
					{t(error)}{" "}
					{!folders && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setRevision((n) => n + 1)}
						>
							{t("retry")}
						</Button>
					)}
				</p>
			)}
		</section>
	);
}
