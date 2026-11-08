"use client";

import { Folder, PanelLeft, PanelTop, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { NewChat } from "@/components/projects/new-chat";
import { Button } from "@/components/ui/button";
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
	/** The address that turned out not to exist; it gets no tab. */
	missing: string | null;
	setMissing: (path: string | null) => void;
};
const Context = createContext<Sessions | null>(null);
export const useSessions = () => useContext(Context)!;

/** Called by the not-found page, so the tab bar stops waiting for a chat that will never load. */
export function useMarkMissing() {
	const setMissing = useContext(Context)?.setMissing;
	const path = usePathname();
	useEffect(() => {
		if (!setMissing) return;
		setMissing(path);
		return () => setMissing(null);
	}, [setMissing, path]);
}

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
	const [missing, setMissing] = useState<string | null>(null);
	const projectWorkspace =
		path === "/" ||
		path === "/memories" ||
		/^\/projects\/[^/]+(?:\/memories)?\/?$/.test(path);
	const showTabs =
		!projectWorkspace &&
		(tabs.length > 0 ||
			(path !== missing && /^\/projects\/[^/]+\/chat\/[^/]+\/?$/.test(path)));
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
		<Context.Provider
			value={{ tabs, register, close, drafts, missing, setMissing }}
		>
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
	const { tabs, close, missing } = useSessions();
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
		path !== missing &&
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
		<Button
			variant="quiet"
			size="icon"
			onClick={switchLayout}
			title={layoutLabel}
			aria-label={layoutLabel}
		>
			<LayoutIcon />
		</Button>
	);
	function navigation(inDrawer = false) {
		return (
			<nav className="session-tabs" aria-label={t("label")}>
				<Button
					variant="quiet"
					size="icon"
					className="session-home"
					nativeButton={false}
					render={<Link href="/" onClick={() => drawer.current?.close()} />}
					title={labels("projects.all")}
					aria-label={labels("projects.all")}
				>
					<img src="/icon.svg" width="25" height="25" alt="" />
				</Button>
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
					<NewChat key={path} scope={scope} compact />
					{inDrawer ? (
						<Button
							variant="quiet"
							size="icon"
							aria-label={labels("library.close")}
							onClick={() => drawer.current?.close()}
						>
							<X />
						</Button>
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
					<div className="session-mobile">
						<Button variant="quiet" onClick={() => drawer.current?.showModal()}>
							<PanelLeft />
							{t("label")}
						</Button>
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
