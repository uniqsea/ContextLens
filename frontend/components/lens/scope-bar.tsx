"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { memoryApi } from "@/lib/memory-api";
import type { Project } from "@/lib/memory-types";
import { ORDINARY } from "./use-scope";

/** Where this work belongs. A project is a hard boundary: isolated unless the user says otherwise. */
export function ScopeBar({
	projects,
	scope,
	onScope,
	onChanged,
}: {
	projects: Project[];
	scope: string;
	onScope: (scope: string) => void;
	onChanged: () => void;
}) {
	const t = useTranslations("lens");
	const [open, setOpen] = useState(false);
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState("");
	const project = projects.find((p) => p.id === scope);

	const choose = (next: string) => {
		setOpen(false);
		onScope(next);
	};
	const option = (id: string, label: string) => (
		<button
			key={id}
			type="button"
			className="lens-menu-item"
			aria-pressed={(project ? scope : ORDINARY) === id}
			onClick={() => choose(id)}
		>
			{label}
			{(project ? scope : ORDINARY) === id && <Check aria-hidden="true" />}
		</button>
	);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setNaming(false);
			}}
		>
			<PopoverTrigger className="lens-scope" aria-label={t("project")}>
				<span>{project?.name ?? t("ordinary")}</span>
				<ChevronDown aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				className="lens-theme lens-menu"
			>
				{option(ORDINARY, t("ordinary"))}
				{projects.map((p) => option(p.id, p.name))}
				<div className="lens-menu-rule" />
				{project && (
					<label className="lens-menu-check">
						<input
							type="checkbox"
							checked={project.isolated}
							onChange={(e) =>
								memoryApi
									.setIsolated(project.id, e.target.checked)
									.then(onChanged)
							}
						/>
						{t("isolated")}
					</label>
				)}
				{naming ? (
					<form
						onSubmit={async (e) => {
							e.preventDefault();
							setNaming(false);
							if (!name.trim()) return;
							const created = await memoryApi.createProject(name.trim());
							setName("");
							onChanged();
							choose(created.id);
						}}
					>
						<input
							// biome-ignore lint/a11y/noAutofocus: the field appears because it was asked for
							autoFocus
							type="text"
							value={name}
							placeholder={t("projectName")}
							aria-label={t("projectName")}
							onChange={(e) => setName(e.target.value)}
							onBlur={() => !name.trim() && setNaming(false)}
						/>
					</form>
				) : (
					<button
						type="button"
						className="lens-menu-item"
						onClick={() => setNaming(true)}
					>
						{t("newProject")}
						<Plus aria-hidden="true" />
					</button>
				)}
			</PopoverContent>
		</Popover>
	);
}
