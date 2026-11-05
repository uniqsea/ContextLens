import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlertDialog } from "@base-ui/react/alert-dialog";

export function DisconnectFolder({
	path,
	onConfirm,
	disabled,
	className,
}: {
	path: string;
	onConfirm: () => void;
	disabled?: boolean;
	className?: string;
}) {
	const t = useTranslations("projectFiles");
	return (
		<AlertDialog.Root>
			<AlertDialog.Trigger
				disabled={disabled}
				className={className}
				title={t("disconnect")}
				aria-label={t("remove", { path })}
			>
				<X />
			</AlertDialog.Trigger>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="lens-scrim pr-editor-scrim fixed inset-0 z-50" />
				<AlertDialog.Popup className="lens-theme pr-disconnect fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6">
					<AlertDialog.Title className="text-lg font-semibold">
						{t("disconnectTitle")}
					</AlertDialog.Title>
					<AlertDialog.Description className="my-4 text-sm">
						<strong className="mb-2 block break-all">{path}</strong>
						{t("disconnectEffect")}
					</AlertDialog.Description>
					<div className="flex justify-end gap-2">
						<AlertDialog.Close className="lens-btn outline">
							{t("cancel")}
						</AlertDialog.Close>
						<AlertDialog.Close
							className="lens-btn solid-danger"
							onClick={onConfirm}
						>
							{t("disconnect")}
						</AlertDialog.Close>
					</div>
				</AlertDialog.Popup>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}
