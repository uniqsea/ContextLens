"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item } from "@/components/ui/item";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
		<Item
			key={id}
			variant="menu"
			size="xs"
			render={<button type="button" />}
			className="justify-between"
			aria-pressed={(project ? scope : ORDINARY) === id}
			onClick={() => choose(id)}
		>
			{label}
			{(project ? scope : ORDINARY) === id && (
				<Check aria-hidden="true" className="size-[15px]" />
			)}
		</Item>
	);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setNaming(false);
			}}
		>
			<PopoverTrigger
				render={<Button variant="secondary" size="sm" />}
				className="min-w-0 max-w-[170px] gap-1 pr-2 [&>svg]:text-muted-foreground"
				aria-label={t("project")}
			>
				<span className="truncate">{project?.name ?? t("ordinary")}</span>
				<ChevronDown aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent align="start" sideOffset={6} variant="menu">
				{option(ORDINARY, t("ordinary"))}
				{projects.map((p) => option(p.id, p.name))}
				<Separator className="mx-2.5 my-1 w-auto" />
				{project && (
					<div className="flex items-center justify-between gap-3 py-[7px] pr-1.5 pl-2.5 text-muted-foreground">
						<span id="scope-isolated">{t("isolated")}</span>
						<Switch
							aria-labelledby="scope-isolated"
							checked={project.isolated}
							onCheckedChange={(checked) =>
								memoryApi.setIsolated(project.id, checked).then(onChanged)
							}
						/>
					</div>
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
						<Input
							autoFocus
							className="h-8"
							value={name}
							placeholder={t("projectName")}
							aria-label={t("projectName")}
							onChange={(e) => setName(e.target.value)}
							onBlur={() => !name.trim() && setNaming(false)}
						/>
					</form>
				) : (
					<Item
						variant="menu"
						size="xs"
						render={<button type="button" />}
						className="justify-between"
						onClick={() => setNaming(true)}
					>
						{t("newProject")}
						<Plus aria-hidden="true" className="size-[15px]" />
					</Item>
				)}
			</PopoverContent>
		</Popover>
	);
}
