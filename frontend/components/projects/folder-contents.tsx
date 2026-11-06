import { Folder, FolderOpen, RefreshCw, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { InlineConfirm } from "@/components/inline-confirm";
import { InlineLoading } from "@/components/page-status";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleChevron,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemTitle,
} from "@/components/ui/item";
import { SearchField } from "@/components/ui/search-field";
import {
	type FileEntry,
	folderApi,
	type ProjectFolder,
} from "@/lib/projects/folders";
import { Breadcrumb, DirectoryLink } from "./file-browser-controls";
import { FileIcon } from "./file-icon";

const PAGE_SIZE = 100;

export function FolderContents({
	project,
	folder,
	list,
	busy,
	onRemove,
}: {
	project: string;
	folder: ProjectFolder;
	list: boolean;
	busy: boolean;
	onRemove: () => void;
}) {
	const t = useTranslations("projectFiles");
	const [expanded, setExpanded] = useState(true);
	const [confirming, setConfirming] = useState(false);
	const [files, setFiles] = useState<FileEntry[] | null>(null);
	const [directory, setDirectory] = useState("");
	const [query, setQuery] = useState("");
	const rootName = folder.path.split("/").filter(Boolean).at(-1) ?? folder.path;
	function navigate(path: string) {
		setDirectory(path);
		setQuery("");
	}
	const [failed, setFailed] = useState(false);
	const [limit, setLimit] = useState(PAGE_SIZE);
	const [revision, refresh] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision requests a fresh listing
	useEffect(() => {
		const controller = new AbortController();
		setFailed(false);
		setFiles(null);
		setLimit(PAGE_SIZE);
		if (!expanded) return;
		const timer = setTimeout(
			() => {
				folderApi
					.entries(
						project,
						folder.id,
						directory,
						query.trim(),
						controller.signal,
					)
					.then((items) => {
						if (!controller.signal.aborted) setFiles(items);
					})
					.catch(() => {
						if (!controller.signal.aborted) setFailed(true);
					});
			},
			query.trim() ? 180 : 0,
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [project, folder.id, revision, directory, query, expanded]);
	const hasQuery = query.trim() !== "";
	return (
		<Collapsible
			render={<li />}
			open={expanded}
			onOpenChange={setExpanded}
			className="grid gap-2 py-3"
		>
			<div className="flex items-center gap-1">
				<Item
					variant="menu"
					size="xs"
					title={folder.path}
					render={<CollapsibleTrigger />}
					className="min-w-0 flex-1 flex-nowrap gap-2 px-2 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground"
				>
					<CollapsibleChevron />
					<Folder aria-hidden />
					<strong className="min-w-0 font-medium [overflow-wrap:anywhere]">
						{rootName}
					</strong>
				</Item>
				<Button
					variant="quiet"
					size="icon-sm"
					title={t("refreshFiles")}
					aria-label={t("refreshFiles")}
					onClick={() => refresh((v) => v + 1)}
				>
					<RefreshCw />
				</Button>
				<Button
					variant="quiet"
					size="icon-sm"
					title={t("disconnect")}
					aria-label={t("remove", { path: folder.path })}
					aria-expanded={confirming}
					disabled={busy}
					onClick={() => setConfirming((v) => !v)}
				>
					<Unlink />
				</Button>
			</div>
			{confirming && (
				<InlineConfirm
					cancelLabel={t("cancel")}
					confirmLabel={t("disconnect")}
					busy={busy}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						onRemove();
					}}
				>
					<strong className="mb-1 block font-medium break-all">
						{folder.path}
					</strong>
					{t("disconnectEffect")}
				</InlineConfirm>
			)}
			<CollapsibleContent className="ml-[15px] grid gap-2 border-l border-border pl-4">
				<div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border pb-2.5">
					<Breadcrumb
						rootName={rootName}
						directory={directory}
						navigate={navigate}
					/>
					<SearchField
						label={t("searchFiles")}
						value={query}
						onValueChange={setQuery}
						className="w-44 max-w-full"
					/>
				</div>
				{failed ? (
					<p role="alert" className="text-[13px] text-muted-foreground">
						{t("unavailable")}
					</p>
				) : !files ? (
					<InlineLoading label={t("loadingFiles")} />
				) : !files.length ? (
					<p className="text-[13px] text-muted-foreground">
						{t(hasQuery ? "noMatches" : "emptyFiles")}
					</p>
				) : (
					<>
						<ul
							className={
								list
									? "grid"
									: "grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-2 [&_[data-slot=item]]:h-full [&_[data-slot=item]]:min-h-16 [&_[data-slot=item]]:border-border [&_[data-slot=item]]:bg-card"
							}
						>
							{files.slice(0, limit).map((entry) => (
								<li key={entry.path}>
									{entry.directory ? (
										<DirectoryLink
											name={entry.name}
											onOpen={() => navigate(entry.path)}
										/>
									) : (
										<Item size="xs" className="flex-nowrap">
											<FileIcon name={entry.name} />
											<ItemContent className="min-w-0">
												<ItemTitle className="line-clamp-none font-normal [overflow-wrap:anywhere]">
													{entry.name}
												</ItemTitle>
												{hasQuery && (
													<small className="truncate text-xs text-muted-foreground">
														{entry.path}
													</small>
												)}
											</ItemContent>
											{hasQuery && (
												<ItemActions>
													<Button
														variant="quiet"
														size="icon-sm"
														title={t("containing")}
														aria-label={t("containing")}
														onClick={() =>
															navigate(
																entry.path.split("/").slice(0, -1).join("/"),
															)
														}
													>
														<FolderOpen />
													</Button>
												</ItemActions>
											)}
										</Item>
									)}
								</li>
							))}
						</ul>
						{files.length > limit && (
							<Button
								variant="secondary"
								size="sm"
								className="justify-self-start"
								onClick={() => setLimit((v) => v + PAGE_SIZE)}
							>
								{t("moreFiles")}
							</Button>
						)}
					</>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
