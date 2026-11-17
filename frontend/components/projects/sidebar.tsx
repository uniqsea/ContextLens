import {
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
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { Hint } from "@/components/ui/tooltip";
import {
	ORDINARY,
	projectPath,
	type WorkspaceProject,
} from "@/lib/projects/types";
import { useRecentProjects } from "./use-recent-projects";
import { WorkspaceSearch } from "./workspace-search";
import {
	Collapsible,
	CollapsibleChevron,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function ProjectSidebar({
	scope,
	library = false,
	projects,
	unfiled,
}: {
	scope?: string;
	library?: boolean;
	projects: WorkspaceProject[];
	unfiled?: number;
}) {
	const t = useTranslations("projects");
	const lib = useTranslations("library");
	const labels = useTranslations("sessionTabs");
	const { tabs, close } = useSessions();
	const recent = useRecentProjects(scope);
	const { state, isMobile, openMobile, setOpenMobile } = useSidebar();
	const collapsed = state === "collapsed" && !isMobile;
	const toggleLabel = t(collapsed ? "showSidebar" : "hideSidebar");
	const recentProjects = recent.flatMap((id) =>
		projects.filter((p) => p.id === id && !p.starred),
	);
	const link = (
		href: string,
		label: string,
		Icon: typeof Folder,
		active: boolean,
		count?: number,
	) => (
		<SidebarMenuItem key={href}>
			<SidebarMenuButton
				render={<Link href={href} />}
				tooltip={label}
				className="pr-nav"
				isActive={active}
				aria-label={label}
				aria-current={active ? "page" : undefined}
				onClick={() => setOpenMobile(false)}
			>
				<Icon />
				<span>{label}</span>
				{count ? <small>{count}</small> : null}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
	return (
		<>
			<SidebarTrigger
				className="m-2 md:hidden"
				aria-label={t("showSidebar")}
				aria-expanded={openMobile}
			/>
			<Sidebar collapsible="icon">
				<SidebarHeader>
					<div className="relative grid h-8 grid-cols-[minmax(0,1fr)_auto] items-start transition-[height] duration-200 ease-settle group-data-[collapsible=icon]:h-16 motion-reduce:transition-none">
						<div
							className="flex h-8 items-center overflow-hidden pr-8"
							inert={collapsed}
						>
							<Link
								href="/"
								className="lens-mark w-fit transition-opacity duration-150 group-data-[collapsible=icon]:opacity-0 motion-reduce:transition-none"
							>
								<BrandLogo wordmarkOnly />
							</Link>
						</div>
						<WorkspaceSearch onNavigate={() => setOpenMobile(false)} />
						<SidebarTrigger
							aria-label={isMobile ? t("hideSidebar") : toggleLabel}
							aria-expanded={isMobile ? openMobile : !collapsed}
						/>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<nav aria-label={t("all")}>
						<SidebarGroup>
							<SidebarMenu>
								{link(
									"/",
									t("all"),
									Folders,
									!scope && !library,
									projects.length,
								)}
								{link(
									projectPath(ORDINARY),
									t("ordinary"),
									MessageSquare,
									scope === ORDINARY,
									unfiled,
								)}
								{link("/memories", lib("title"), Library, library)}
							</SidebarMenu>
						</SidebarGroup>
						{[
							{
								label: t("starred"),
								Icon: Star,
								items: projects.filter((p) => p.starred),
							},
							{ label: t("recent"), Icon: Clock3, items: recentProjects },
						].map(
							({ label, Icon, items }) =>
								items.length > 0 && (
									<SidebarGroup
										key={label}
										className="group-data-[collapsible=icon]:hidden"
									>
										<SidebarGroupLabel className="pr-nav-label gap-2">
											<Icon />
											{label}
										</SidebarGroupLabel>
										<SidebarMenu>
											{items.map((p) =>
												link(
													projectPath(p.id),
													p.name,
													Folder,
													scope === p.id,
													p.chats,
												),
											)}
										</SidebarMenu>
									</SidebarGroup>
								),
						)}
					</nav>
					{tabs.length > 0 && (
						<Collapsible className="pr-open-sessions group-data-[collapsible=icon]:hidden">
							<CollapsibleTrigger
								render={
									<Button
										variant="quiet"
										className="pr-open-trigger h-auto w-full justify-start rounded-lg px-2.5 py-2 font-normal"
									/>
								}
							>
								<PanelsTopLeft />
								<span>{labels("label")}</span>
								<small>{tabs.length}</small>
								<CollapsibleChevron />
							</CollapsibleTrigger>
							<CollapsibleContent render={<ul />}>
								{tabs.map((tab) => {
									const project = tab.projectName ?? t("ordinary");
									const label = project + " · " + tab.title;
									return (
										<li key={tab.href}>
											<Hint label={label}>
												<Link
													href={tab.href}
													onClick={() => setOpenMobile(false)}
												>
													<span>{tab.title}</span>
													<small>{project}</small>
												</Link>
											</Hint>
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
							</CollapsibleContent>
						</Collapsible>
					)}
				</SidebarContent>
				<SidebarFooter className="group-data-[collapsible=icon]:hidden">
					<LocaleSwitch className="self-start" />
				</SidebarFooter>
				<SidebarRail label={t("resizeSidebar")} />
			</Sidebar>
		</>
	);
}
