import {
	Clock3,
	Folder,
	Folders,
	MessageSquare,
	Search,
	Star,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { LocaleSwitch } from "@/components/locale-switch";
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
			<label className="pr-search">
				<Search aria-hidden="true" />
				<input
					type="search"
					value={query}
					onChange={(e) => onQuery(e.target.value)}
					placeholder={t(scope ? "searchChats" : "search")}
					aria-label={t(scope ? "searchChats" : "search")}
				/>
			</label>
			<nav aria-label={t("all")}>
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
			<LocaleSwitch className="lens-seg" />
		</aside>
	);
}
