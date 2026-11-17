"use client";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Message,
	MessageContent,
	MessageFooter,
} from "@/components/ui/message";
import { Hint } from "@/components/ui/tooltip";
import { useLensText } from "@/lib/lens/text";
import { QuestionBubble } from "./question-bubble";

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
		<Message align="end" className="text-[length:inherit]">
			<MessageContent className="max-w-[85%] items-end gap-1.5">
				<div className="flex min-w-0 items-center gap-2">
					<CircleAlert
						aria-hidden
						className={
							latest
								? "size-4 shrink-0 text-destructive"
								: "size-4 shrink-0 text-muted-foreground"
						}
					/>
					<QuestionBubble
						className={latest ? "max-w-full" : "max-w-full opacity-60"}
					>
						{question}
					</QuestionBubble>
				</div>
				<MessageFooter className="gap-2 px-0 text-[12.5px] font-normal">
					<Hint label={detail}>
						<span role={latest ? "status" : undefined}>{reason}</span>
					</Hint>
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
				</MessageFooter>
			</MessageContent>
		</Message>
	);
}

// What a browser says when the request never reached the server.
const OFFLINE =
	/failed to fetch|networkerror|network error|load failed|econnrefused/i;
