import {
	ChevronDown,
	ChevronRight,
	Folder,
	FolderOpen,
	RefreshCw,
	Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
	type FileEntry,
	folderApi,
	type ProjectFolder,
} from "@/lib/projects/folders";
import { DisconnectFolder } from "./disconnect-folder";

import { FileIcon } from "./file-icon";

const PAGE_SIZE = 100;

export function FolderContents({
	project,
	folder,
	busy,
	onRemove,
}: {
	project: string;
	folder: ProjectFolder;
	busy: boolean;
	onRemove: () => void;
}) {
	const t = useTranslations("projectFiles");
	const [expanded, setExpanded] = useState(true);
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
	return (
		<li className="pr-file-group">
			<div className="pr-file-head">
				<button
					className="pr-file-toggle"
					type="button"
					aria-expanded={expanded}
					title={folder.path}
					onClick={() => setExpanded((v) => !v)}
				>
					{expanded ? <ChevronDown /> : <ChevronRight />}
					<Folder />
					<strong>{rootName}</strong>
				</button>
				<button
					type="button"
					className="lens-btn outline"
					aria-label={t("refreshFiles")}
					onClick={() => refresh((v) => v + 1)}
				>
					<RefreshCw />
				</button>
				<DisconnectFolder
					path={folder.path}
					disabled={busy}
					className="lens-btn outline"
					onConfirm={onRemove}
				/>
			</div>
			{expanded && (
				<div className="pr-file-body">
					<div className="pr-browser-tools">
						<nav aria-label={t("location")}>
							<button type="button" onClick={() => navigate("")}>
								{rootName}
							</button>
							{directory &&
								directory.split("/").map((part, i, parts) => (
									<span key={parts.slice(0, i + 1).join("/")}>
										<ChevronRight />
										<button
											type="button"
											onClick={() => navigate(parts.slice(0, i + 1).join("/"))}
										>
											{part}
										</button>
									</span>
								))}
						</nav>
						<label>
							<Search />
							<input
								type="search"
								aria-label={t("searchFiles")}
								placeholder={t("searchFiles")}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</label>
					</div>
					{failed ? (
						<p role="alert">{t("unavailable")}</p>
					) : !files ? (
						<p role="status">{t("loadingFiles")}</p>
					) : !files.length ? (
						<p>{t(query.trim() ? "noMatches" : "emptyFiles")}</p>
					) : (
						<>
							<ul>
								{files.slice(0, limit).map((entry) => (
									<li key={entry.path} className="pr-file-entry">
										{entry.directory ? (
											<button
												className="pr-directory-link"
												type="button"
												onClick={() => navigate(entry.path)}
											>
												<FileIcon directory name={entry.name} />
												<span>{entry.name}</span>
												<ChevronRight />
											</button>
										) : (
											<>
												<FileIcon name={entry.name} />
												<span>
													{entry.name}
													{query.trim() && <small>{entry.path}</small>}
												</span>
												{query.trim() && (
													<button
														type="button"
														className="lens-btn"
														title={t("containing")}
														aria-label={t("containing")}
														onClick={() =>
															navigate(
																entry.path.split("/").slice(0, -1).join("/"),
															)
														}
													>
														<FolderOpen />
													</button>
												)}
											</>
										)}
									</li>
								))}
							</ul>
							{files.length > limit && (
								<button
									type="button"
									className="lens-btn"
									onClick={() => setLimit((v) => v + PAGE_SIZE)}
								>
									{t("moreFiles")}
								</button>
							)}
						</>
					)}
				</div>
			)}
		</li>
	);
}
