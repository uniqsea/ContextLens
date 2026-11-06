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
import { useSessions } from "@/components/lens/session-tabs";
import { Button } from "@/components/ui/button";
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
	const [action, setAction] = useState<"rename" | "delete" | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	function open(next: "rename" | "delete") {
		setDraft(title);
		setFailed(false);
		setAction(next);
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
				await deleteConversation(id);
				close(href);
			}
			setAction(null);
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
				open={action !== null}
				onOpenChange={(v) => {
					if (!v && !busy) {
						setAction(null);
						setFailed(false);
					}
				}}
			>
				<DialogContent className="sm:max-w-sm">
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
							<DialogDescription>
								{t("conversationTitle.confirmRemove", { title })}
							</DialogDescription>
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
									setAction(null);
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
