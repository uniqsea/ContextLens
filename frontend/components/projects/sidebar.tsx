import {
	ChevronRight,
	Clock3,
	Folder,
	Folders,
	Library,
	MessageSquare,
	PanelsTopLeft,
	Star,
	X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { useSessions } from "@/components/lens/session-tabs";
import { LocaleSwitch } from "@/components/locale-switch";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
	ORDINARY,
	projectPath,
	type WorkspaceProject,
} from "@/lib/projects/types";

import { useRecentProjects } from "./use-recent-projects";

export function ProjectSidebar({
	scope,
	library = false,
	projects,
	query,
	onQuery,
}: {
	scope?: string;
	library?: boolean;
	projects: WorkspaceProject[];
	query?: string;
	onQuery?: (value: string) => void;
}) {
	const t = useTranslations("projects");
	const lib = useTranslations("library");
	const labels = useTranslations("sessionTabs");
	const { tabs, close } = useSessions();
	const recent = useRecentProjects(scope);
	const recentProjects = recent.flatMap((id) =>
		projects.filter((p) => p.id === id && !p.starred),
	);
	const projectLink = (p: WorkspaceProject) => (
		<Link
			key={p.id}
			href={projectPath(p.id)}
			aria-current={scope === p.id ? "page" : undefined}
		>
			<Folder />
			<span>{p.name}</span>
		</Link>
	);
	return (
		<aside className="pr-side">
			<Link href="/" className="lens-mark">
				<BrandLogo />
			</Link>
			{onQuery && (
				<SearchField
					label={t(scope ? "searchChats" : "search")}
					value={query ?? ""}
					onValueChange={onQuery}
				/>
			)}
			<nav className="pr-project-links" aria-label={t("all")}>
				<Link href="/" aria-current={!scope && !library ? "page" : undefined}>
					<Folders />
					{t("all")}
				</Link>
				<Link
					href={projectPath(ORDINARY)}
					aria-current={scope === ORDINARY ? "page" : undefined}
				>
					<MessageSquare />
					{t("ordinary")}
				</Link>
				<Link href="/memories" aria-current={library ? "page" : undefined}>
					<Library />
					{lib("title")}
				</Link>
				{projects.some((p) => p.starred) && (
					<h2>
						<Star />
						{t("starred")}
					</h2>
				)}
				{projects.filter((p) => p.starred).map(projectLink)}
				{recentProjects.length > 0 && (
					<h2>
						<Clock3 />
						{t("recent")}
					</h2>
				)}
				{recentProjects.map(projectLink)}
			</nav>
			{tabs.length > 0 && (
				<details className="pr-open-sessions">
					<summary>
						<PanelsTopLeft />
						<span>{labels("label")}</span>
						<small>{tabs.length}</small>
						<ChevronRight />
					</summary>
					<ul>
						{tabs.map((tab) => {
							const project = tab.projectName ?? t("ordinary");
							const label = project + " · " + tab.title;
							return (
								<li key={tab.href}>
									<Link href={tab.href} title={label}>
										<span>{tab.title}</span>
										<small>{project}</small>
									</Link>
									<Button
										variant="quiet"
										size="icon-sm"
										aria-label={labels("close", { title: label })}
										onClick={() => close(tab.href)}
									>
										<X />
									</Button>
								</li>
							);
						})}
					</ul>
				</details>
			)}
			<LocaleSwitch className="mt-auto self-start max-[700px]:absolute max-[700px]:top-3 max-[700px]:right-4" />
		</aside>
	);
}
