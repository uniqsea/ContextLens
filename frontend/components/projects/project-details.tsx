import { useTranslations } from "next-intl";
import { useState } from "react";
import { memoryApi } from "@/lib/memory-api";
import { saveSettings } from "@/lib/projects/settings";
import type { WorkspaceProject } from "@/lib/projects/types";

export function ProjectDetails({
	project,
	onChanged,
}: {
	project: WorkspaceProject;
	onChanged: () => void;
}) {
	const t = useTranslations();
	const [description, setDescription] = useState(project.description);
	const [isolated, setIsolated] = useState(project.isolated);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	return (
		<form
			className="pr-form pr-details"
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setFailed(false);
				try {
					if (description !== project.description)
						await saveSettings(project.id, { description });
					if (isolated !== project.isolated)
						await memoryApi.setIsolated(project.id, isolated);
					onChanged();
				} catch {
					setFailed(true);
				} finally {
					setBusy(false);
				}
			}}
		>
			<label>
				{t("projects.details")}
				<textarea
					rows={5}
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
			</label>
			<label className="pr-check">
				<input
					type="checkbox"
					checked={isolated}
					onChange={(e) => setIsolated(e.target.checked)}
				/>
				{t("lens.isolated")}
			</label>
			{failed && <p role="alert">{t("projects.failed")}</p>}
			<button
				type="submit"
				className="lens-btn"
				disabled={
					busy ||
					(description === project.description && isolated === project.isolated)
				}
			>
				{t("projects.save")}
			</button>
		</form>
	);
}
