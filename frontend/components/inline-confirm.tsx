import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** An irreversible step, confirmed in place: one line on what it does, then cancel or go ahead. */
export function InlineConfirm({
	children,
	cancelLabel,
	confirmLabel,
	busy,
	onCancel,
	onConfirm,
}: {
	children: ReactNode;
	cancelLabel: string;
	confirmLabel: string;
	busy?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<div className="grid gap-3 rounded-[18px] bg-destructive/[.07] p-4">
			<div className="text-[13px] text-destructive">{children}</div>
			<div className="flex justify-end gap-2">
				<Button variant="outline" disabled={busy} onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button variant="destructive" disabled={busy} onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</div>
		</div>
	);
}
