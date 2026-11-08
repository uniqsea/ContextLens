"use client";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLensText } from "@/lib/lens/text";

// A question that got no answer: its run failed, or was cancelled when the page went away. Only the
// latest can be sent again; after an earlier one the conversation already went on without it.
export function UnsentQuestion({
	question,
	latest,
	error,
	busy,
	onRetry,
}: {
	question: string;
	latest: boolean;
	// The failure of the run just made, when this page saw it.
	error?: unknown;
	busy: boolean;
	onRetry: () => void;
}) {
	const { t } = useLensText();
	const detail = error ? String((error as Error)?.message ?? error) : undefined;
	const reason = !detail
		? t("lens.noAnswer")
		: OFFLINE.test(detail)
			? t("lens.unreachable")
			: t("lens.answerFailed");
	return (
		<div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
			<div className="flex min-w-0 items-center gap-2">
				<CircleAlert
					aria-hidden
					className={
						latest
							? "size-4 shrink-0 text-destructive"
							: "size-4 shrink-0 text-muted-foreground"
					}
				/>
				<div
					className="lens-q"
					style={{ maxWidth: "none", opacity: latest ? 1 : 0.6 }}
				>
					{question}
				</div>
			</div>
			<div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
				<span role={latest ? "status" : undefined} title={detail}>
					{reason}
				</span>
				{latest && (
					<Button
						variant="secondary"
						size="chip"
						disabled={busy}
						onClick={onRetry}
					>
						<RotateCw />
						{t("lens.retry")}
					</Button>
				)}
			</div>
		</div>
	);
}

// What a browser says when the request never reached the server.
const OFFLINE =
	/failed to fetch|networkerror|network error|load failed|econnrefused/i;
