"use client";

import { Folder, MessageSquare, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { projectPath } from "@/lib/projects/types";
import { useDirectory } from "./use-directory";

export function WorkspaceSearch({ onNavigate }: { onNavigate: () => void }) {
	const t = useTranslations("projects");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant="quiet"
						size="icon-sm"
						aria-label={t("workspaceSearch")}
						title={t("workspaceSearch")}
						className="absolute right-8 top-0 transition-[translate] duration-200 ease-settle group-data-[collapsible=icon]:translate-x-8 group-data-[collapsible=icon]:translate-y-8 motion-reduce:transition-none"
					/>
				}
			>
				<Search />
			</DialogTrigger>
			<DialogContent className="gap-0 p-3 sm:max-w-lg">
				<DialogTitle className="sr-only">{t("workspaceSearch")}</DialogTitle>
				{open && (
					<SearchResults
						onSelect={(href) => {
							setOpen(false);
							onNavigate();
							router.push(href);
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function SearchResults({ onSelect }: { onSelect: (href: string) => void }) {
	const t = useTranslations();
	const { data, failed, reload } = useDirectory(undefined, "search");
	const [category, setCategory] = useState("all");
	const groups = [
		{
			key: "projects",
			label: t("projects.projectResults"),
			Icon: Folder,
			items: (data?.projects ?? []).map((p) => ({
				href: projectPath(p.id),
				title: p.name,
				detail: p.latest,
			})),
		},
		{
			key: "sessions",
			label: t("projects.sessionResults"),
			Icon: MessageSquare,
			items: (data?.conversations ?? []).map((c) => ({
				href: `${projectPath(c.scope)}/chat/${c.id}`,
				title: c.title || t("lens.newChat"),
				detail: c.preview,
			})),
		},
	];
	return (
		<Command
			label={t("projects.workspaceSearch")}
			filter={(_value, query, keywords) =>
				keywords?.some((k) =>
					k.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
				)
					? 1
					: 0
			}
		>
			<CommandInput
				className="pr-10"
				placeholder={t("projects.workspaceSearch")}
			/>
			<ToggleGroup
				className="my-2"
				size="sm"
				value={[category]}
				aria-label={t("projects.workspaceSearch")}
				onValueChange={(v) => {
					if (v[0]) setCategory(v[0]);
				}}
			>
				<ToggleGroupItem value="all">{t("library.all")}</ToggleGroupItem>
				{groups.map((g) => (
					<ToggleGroupItem key={g.key} value={g.key}>
						{g.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<CommandList className="max-h-[min(45dvh,22rem)] border-t">
				{failed ? (
					<div role="alert">
						{t("projects.failed")}{" "}
						<Button size="sm" variant="quiet" onClick={reload}>
							{t("projects.retry")}
						</Button>
					</div>
				) : !data ? (
					<p role="status" className="p-3">
						{t("library.loading")}
					</p>
				) : (
					<>
						<CommandEmpty>{t("projects.noMatch")}</CommandEmpty>
						{groups
							.filter((g) => category === "all" || g.key === category)
							.map(({ key, label, Icon, items }) => (
								<CommandGroup key={key} heading={label}>
									{items.map((item) => (
										<CommandItem
											key={item.href}
											value={item.href}
											keywords={[item.title, item.detail]}
											onSelect={() => onSelect(item.href)}
										>
											<Icon />
											<span className="min-w-0">
												<span className="block truncate">{item.title}</span>
												{item.detail && (
													<small className="block truncate text-muted-foreground">
														{item.detail}
													</small>
												)}
											</span>
										</CommandItem>
									))}
								</CommandGroup>
							))}
					</>
				)}
			</CommandList>
		</Command>
	);
}
