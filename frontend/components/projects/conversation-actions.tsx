import {
	Archive,
	ArchiveRestore,
	Ellipsis,
	Pencil,
	Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MemoryRecord } from "@/lib/memory-types";
import { memoryApi } from "@/lib/memory-api";
import { useSessions } from "@/components/lens/session-tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	deleteConversation,
	renameConversation,
	setConversationArchived,
} from "@/lib/projects/conversations";

export function ConversationActions({
	id,
	archived,
	href,
	title,
	onChanged,
}: {
	id: string;
	archived: boolean;
	href: string;
	title: string;
	onChanged: () => void;
}) {
	const t = useTranslations();
	const router = useRouter();
	const { tabs, register, close } = useSessions();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [action, setAction] = useState<"rename" | "delete" | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	// What deleting would leave behind: memories this conversation brought in. They stay unless checked.
	const [memories, setMemories] = useState<
		MemoryRecord[] | "loading" | "failed"
	>("loading");
	const [toTrash, setToTrash] = useState<Set<string>>(new Set());
	function open(next: "rename" | "delete") {
		setDraft(title);
		setFailed(false);
		setAction(next);
		setDialogOpen(true);
		if (next === "delete") {
			setMemories("loading");
			setToTrash(new Set());
			memoryApi
				.fromConversation(id)
				.then(setMemories, () => setMemories("failed"));
		}
	}
	function choose(memoryId: string, trash: boolean) {
		setToTrash((previous) => {
			const next = new Set(previous);
			if (trash) next.add(memoryId);
			else next.delete(memoryId);
			return next;
		});
	}
	async function toggleArchived() {
		if (busy) return;
		setBusy(true);
		setFailed(false);
		try {
			await setConversationArchived(id, !archived);
			onChanged();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}
	async function submit() {
		if (!action || busy || (action === "rename" && !draft.trim())) return;
		setBusy(true);
		setFailed(false);
		try {
			if (action === "rename") {
				const next = draft.trim();
				await renameConversation(id, next);
				const tab = tabs.find((item) => item.href === href);
				if (tab) register({ ...tab, title: next });
			} else {
				for (const memoryId of toTrash) await memoryApi.trash(memoryId);
				await deleteConversation(id);
				close(href);
			}
			setDialogOpen(false);
			onChanged();
			router.refresh();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							disabled={busy}
							variant="quiet"
							size="icon-sm"
							className="absolute top-2 right-2 bg-background"
							aria-label={t("conversationTitle.actions", { title })}
						/>
					}
				>
					<Ellipsis />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => open("rename")}>
						<Pencil />
						{t("conversationTitle.rename")}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={toggleArchived}>
						{archived ? <ArchiveRestore /> : <Archive />}
						{t(
							archived
								? "conversationTitle.restore"
								: "conversationTitle.archive",
						)}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={() => open("delete")}
					>
						<Trash2 />
						{t("conversationTitle.remove")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{failed && !action && (
				<p role="alert">{t("conversationTitle.archiveFailed")}</p>
			)}
			<Dialog
				open={dialogOpen}
				onOpenChangeComplete={(open) => {
					if (!open) setAction(null);
				}}
				onOpenChange={(v) => {
					if (!v && !busy) {
						setDialogOpen(false);
						setFailed(false);
					}
				}}
			>
				<DialogContent
					className={action === "delete" ? "sm:max-w-md" : "sm:max-w-sm"}
				>
					<DialogTitle>
						{t(
							action === "delete"
								? "conversationTitle.remove"
								: "conversationTitle.rename",
						)}
					</DialogTitle>
					<form
						className="grid gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							void submit();
						}}
					>
						{action === "delete" ? (
							<>
								<DialogDescription>
									{t("conversationTitle.confirmRemove", { title })}
								</DialogDescription>
								<LeftBehind
									memories={memories}
									toTrash={toTrash}
									disabled={busy}
									onChoose={choose}
								/>
							</>
						) : (
							<Input
								autoFocus
								aria-label={t("conversationTitle.label")}
								value={draft}
								disabled={busy}
								maxLength={100}
								onChange={(e) => setDraft(e.target.value)}
								onFocus={(e) => e.target.select()}
							/>
						)}
						{failed && (
							<p role="alert">
								{t(
									action === "delete"
										? "conversationTitle.deleteFailed"
										: "conversationTitle.failed",
								)}
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => {
									setDialogOpen(false);
									setFailed(false);
								}}
							>
								{t("projectFiles.cancel")}
							</Button>
							<Button
								type="submit"
								variant={action === "delete" ? "destructive" : "default"}
								disabled={busy || (action === "rename" && !draft.trim())}
							>
								{t(
									action === "delete"
										? "conversationTitle.remove"
										: "projects.save",
								)}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

function LeftBehind({
	memories,
	toTrash,
	disabled,
	onChoose,
}: {
	memories: MemoryRecord[] | "loading" | "failed";
	toTrash: Set<string>;
	disabled: boolean;
	onChoose: (id: string, trash: boolean) => void;
}) {
	const t = useTranslations("conversationTitle");
	if (memories === "loading" || memories === "failed" || !memories.length)
		return (
			<p className="text-[13px] text-muted-foreground">
				{t(
					memories === "loading"
						? "memoriesLoading"
						: memories === "failed"
							? "memoriesFailed"
							: "memoriesNone",
				)}
			</p>
		);
	return (
		<div className="grid gap-2">
			<p className="text-[13px] text-muted-foreground">
				{t("memoriesKept", { count: memories.length })}
			</p>
			<ul className="grid max-h-64 gap-0.5 overflow-y-auto rounded-[14px] bg-panel p-1.5">
				{memories.map((m) => (
					<li key={m.id}>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control */}
						<label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-muted">
							<Checkbox
								className="mt-0.5"
								checked={toTrash.has(m.id)}
								disabled={disabled}
								onCheckedChange={(checked) => onChoose(m.id, checked)}
							/>
							<span className="grid min-w-0 gap-0.5">
								<span className="truncate text-[13px] font-medium">
									{m.title}
								</span>
								{m.content !== m.title && (
									<span className="line-clamp-2 text-[12.5px] text-muted-foreground">
										{m.content}
									</span>
								)}
							</span>
						</label>
					</li>
				))}
			</ul>
		</div>
	);
}
