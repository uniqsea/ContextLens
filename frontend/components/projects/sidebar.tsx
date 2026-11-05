import {
	ChevronRight,
	Clock3,
	Folder,
	Folders,
	MessageSquare,
	Star,
	X,
	PanelsTopLeft,
} from "lucide-react";
import { useSessions } from "@/components/lens/session-tabs";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { LocaleSwitch } from "@/components/locale-switch";
import { SearchField } from "@/components/ui/search-field";
import {
	ORDINARY,
	projectPath,
	type WorkspaceProject,
} from "@/lib/projects/types";

import { useRecentProjects } from "./use-recent-projects";

export function ProjectSidebar({
	scope,
	projects,
	query,
	onQuery,
}: {
	scope?: string;
	projects: WorkspaceProject[];
	query: string;
	onQuery: (value: string) => void;
}) {
	const t = useTranslations("projects");
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
			<SearchField
				label={t(scope ? "searchChats" : "search")}
				value={query}
				onValueChange={onQuery}
			/>
			<nav className="pr-project-links" aria-label={t("all")}>
				<Link href="/" aria-current={!scope ? "page" : undefined}>
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
									<button
										type="button"
										aria-label={labels("close", { title: label })}
										onClick={() => close(tab.href)}
									>
										<X />
									</button>
								</li>
							);
						})}
					</ul>
				</details>
			)}
			<LocaleSwitch className="lens-seg" />
		</aside>
	);
}
