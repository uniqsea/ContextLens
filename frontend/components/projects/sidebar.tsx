import {
	ChevronRight,
	Clock3,
	Folder,
	Folders,
	Library,
	MessageSquare,
	PanelLeft,
	PanelsTopLeft,
	Search,
	Star,
	X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactElement, useRef } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useSessions } from "@/components/lens/session-tabs";
import { LocaleSwitch } from "@/components/locale-switch";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	ORDINARY,
	projectPath,
	type WorkspaceProject,
} from "@/lib/projects/types";

import { useRecentProjects } from "./use-recent-projects";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

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
	const [collapsed, toggleCollapsed] = useSidebarCollapsed();
	const toggleLabel = t(collapsed ? "showSidebar" : "hideSidebar");
	const searchLabel = t(scope ? "searchChats" : "search");
	const aside = useRef<HTMLElement>(null);
	/** From the rail, searching means opening the sidebar with the cursor in its search box. */
	function openSearch() {
		toggleCollapsed();
		requestAnimationFrame(() => aside.current?.querySelector("input")?.focus());
	}
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
		<aside ref={aside} className="pr-side">
			<div className="pr-side-head">
				<Link href="/" className="lens-mark">
					<BrandLogo />
				</Link>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="quiet"
								size="icon-sm"
								aria-label={toggleLabel}
								aria-expanded={!collapsed}
								onClick={toggleCollapsed}
							/>
						}
					>
						<PanelLeft />
					</TooltipTrigger>
					<TooltipContent side={collapsed ? "right" : "bottom"}>
						{toggleLabel}
					</TooltipContent>
				</Tooltip>
			</div>
			{onQuery && (
				<>
					<SearchField
						label={searchLabel}
						value={query ?? ""}
						onValueChange={onQuery}
					/>
					<RailTip label={searchLabel} rail={collapsed}>
						<Button
							variant="quiet"
							size="icon"
							className="pr-rail-search"
							aria-label={searchLabel}
							onClick={openSearch}
						>
							<Search />
						</Button>
					</RailTip>
				</>
			)}
			<nav className="pr-project-links" aria-label={t("all")}>
				<RailTip label={t("all")} rail={collapsed}>
					<Link
						href="/"
						className="pr-main-link"
						aria-current={!scope && !library ? "page" : undefined}
					>
						<Folders />
						<span>{t("all")}</span>
					</Link>
				</RailTip>
				<RailTip label={t("ordinary")} rail={collapsed}>
					<Link
						href={projectPath(ORDINARY)}
						className="pr-main-link"
						aria-current={scope === ORDINARY ? "page" : undefined}
					>
						<MessageSquare />
						<span>{t("ordinary")}</span>
					</Link>
				</RailTip>
				<RailTip label={lib("title")} rail={collapsed}>
					<Link
						href="/memories"
						className="pr-main-link"
						aria-current={library ? "page" : undefined}
					>
						<Library />
						<span>{lib("title")}</span>
					</Link>
				</RailTip>
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

/** In the folded rail only the icon shows, so its name moves into a tooltip. */
function RailTip({
	label,
	rail,
	children,
}: {
	label: string;
	rail: boolean;
	children: ReactElement;
}) {
	return (
		<Tooltip disabled={!rail}>
			<TooltipTrigger render={children} />
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}
