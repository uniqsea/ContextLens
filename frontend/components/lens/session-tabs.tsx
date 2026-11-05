"use client";

import { Folder, PanelLeft, PanelTop, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { NewChat } from "@/components/projects/new-chat";
import { ORDINARY, projectPath } from "@/lib/projects/types";

type Tab = {
	href: string;
	title: string;
	scope: string;
	projectName: string | null;
};
type Layout = "top" | "side";
const layoutKey = "contextlens.sessionTabLayout";
type Sessions = {
	tabs: Tab[];
	register: (tab: Tab) => void;
	close: (href: string) => void;
	drafts: Map<string, string>;
};
const Context = createContext<Sessions | null>(null);
export const useSessions = () => useContext(Context)!;

export function SessionProvider({ children }: { children: ReactNode }) {
	const path = usePathname();
	const [layout, setLayout] = useState<Layout>("top");
	useEffect(() => {
		try {
			if (localStorage.getItem(layoutKey) === "side") setLayout("side");
		} catch {}
	}, []);
	function switchLayout() {
		const next = layout === "top" ? "side" : "top";
		setLayout(next);
		try {
			localStorage.setItem(layoutKey, next);
		} catch {}
	}
	const [tabs, setTabs] = useState<Tab[]>([]);
	const projectWorkspace = path === "/" || /^\/projects\/[^/]+\/?$/.test(path);
	const showTabs =
		!projectWorkspace &&
		(tabs.length > 0 || /^\/projects\/[^/]+\/chat\/[^/]+\/?$/.test(path));
	const [drafts] = useState(() => new Map<string, string>());
	const register = useCallback((tab: Tab) => {
		setTabs((previous) => {
			const existing = previous.find((item) => item.href === tab.href);
			if (!existing) return [...previous, tab];
			if (
				existing.title === tab.title &&
				existing.projectName === tab.projectName
			)
				return previous;
			return previous.map((item) => (item.href === tab.href ? tab : item));
		});
	}, []);
	function close(href: string) {
		drafts.delete(href);
		setTabs((previous) => previous.filter((tab) => tab.href !== href));
	}
	return (
		<Context.Provider value={{ tabs, register, close, drafts }}>
			<div className="session-shell" data-layout={showTabs ? layout : "none"}>
				{showTabs && (
					<SessionTabs layout={layout} switchLayout={switchLayout} />
				)}
				{children}
			</div>
		</Context.Provider>
	);
}

function SessionTabs({
	layout,
	switchLayout,
}: {
	layout: Layout;
	switchLayout: () => void;
}) {
	const { tabs, close } = useSessions();
	const path = usePathname();
	const router = useRouter();
	const t = useTranslations("sessionTabs");
	const drawer = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (path) drawer.current?.close();
	}, [path, layout]);
	useEffect(() => {
		const desktop = window.matchMedia("(min-width: 901px)");
		function closeOnDesktop() {
			if (desktop.matches) drawer.current?.close();
		}
		desktop.addEventListener("change", closeOnDesktop);
		return () => desktop.removeEventListener("change", closeOnDesktop);
	}, []);
	const active = useRef<HTMLAnchorElement>(null);
	useEffect(() => {
		active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [path, tabs, layout]);
	const labels = useTranslations();
	const project = path.match(/^\/projects\/([^/]+)/);
	const scope = project ? decodeURIComponent(project[1]) : ORDINARY;
	const entering =
		project &&
		path.includes("/chat/") &&
		!tabs.some((tab) => tab.href === path);
	const visible = entering
		? [
				...tabs,
				{
					href: path,
					scope,
					title: t("loading"),
					projectName:
						tabs.find((tab) => tab.scope === scope)?.projectName ?? null,
				},
			]
		: tabs;
	const layoutLabel = layout === "top" ? t("useSide") : t("useTop");
	const LayoutIcon = layout === "top" ? PanelLeft : PanelTop;
	const toggle = (
		<button
			type="button"
			className="session-control"
			onClick={switchLayout}
			title={layoutLabel}
			aria-label={layoutLabel}
		>
			<LayoutIcon size={17} />
		</button>
	);
	function navigation(inDrawer = false) {
		return (
			<nav className="session-tabs lens-theme" aria-label={t("label")}>
				<Link
					href="/"
					className="session-home session-control"
					onClick={() => drawer.current?.close()}
					title={labels("projects.all")}
					aria-label={labels("projects.all")}
				>
					<img src="/icon.svg" width="25" height="25" alt="" />
				</Link>
				<div className="session-tab-list">
					{visible.map((tab, index) => {
						const project =
							tab.projectName ??
							(tab.scope === ORDINARY ? labels("projects.ordinary") : "");
						const fullTitle = [project, tab.title].filter(Boolean).join(" · ");
						return (
							<div
								className="session-tab"
								key={tab.href}
								data-active={path === tab.href}
							>
								<Link
									href={tab.href}
									title={fullTitle}
									onClick={() => drawer.current?.close()}
									aria-current={path === tab.href ? "page" : undefined}
									ref={!inDrawer && path === tab.href ? active : undefined}
								>
									<small>
										<Folder size={11} />
										<span>{project}</span>
									</small>
									<strong>{tab.title}</strong>
								</Link>
								<button
									type="button"
									aria-label={t("close", { title: fullTitle })}
									onClick={() => {
										if (path === tab.href)
											router.replace(
												(tabs[index + 1] ?? tabs[index - 1])?.href ??
													projectPath(tab.scope),
											);
										close(tab.href);
									}}
								>
									<X size={13} />
								</button>
							</div>
						);
					})}
				</div>
				<div className="session-actions">
					<NewChat
						key={path}
						scope={scope}
						className="session-control session-add"
						compact
					/>
					{inDrawer ? (
						<button
							type="button"
							className="session-control"
							aria-label={labels("library.close")}
							onClick={() => drawer.current?.close()}
						>
							<X size={17} />
						</button>
					) : (
						toggle
					)}
				</div>
			</nav>
		);
	}
	return (
		<>
			{navigation()}
			{layout === "side" && (
				<>
					<div className="session-mobile lens-theme">
						<button
							type="button"
							className="session-control"
							onClick={() => drawer.current?.showModal()}
						>
							<PanelLeft size={17} />
							{t("label")}
						</button>
						{toggle}
					</div>
					<dialog
						className="session-drawer"
						ref={drawer}
						aria-label={t("label")}
						onClick={(event) => {
							if (event.target === event.currentTarget) drawer.current?.close();
						}}
					>
						{navigation(true)}
					</dialog>
				</>
			)}
		</>
	);
}

export function SessionProgress() {
	const t = useTranslations("sessionTabs");
	return (
		<div className="session-loading">
			<div className="session-loading-center">
				<img src="/icon.svg" width="22" height="22" alt="" />
				<div
					className="session-track"
					role="progressbar"
					aria-label={t("loading")}
				>
					<span />
				</div>
			</div>
		</div>
	);
}

export function useHistoryLoading(loading: boolean) {
	const [painted, setPainted] = useState(false);
	useEffect(() => {
		if (loading) {
			setPainted(false);
			return;
		}
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setPainted(true));
		});
		return () => cancelAnimationFrame(frame);
	}, [loading]);
	return loading || !painted;
}
