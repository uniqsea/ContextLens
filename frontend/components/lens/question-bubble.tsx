import type { ReactNode } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";

/** A question as the conversation shows it: the person's side, in a muted bubble. */
export function QuestionBubble({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<Bubble align="end" variant="muted" className={className ?? "max-w-[85%]"}>
			<BubbleContent className="rounded-[18px] px-3.5 text-(length:--type-ui) whitespace-pre-wrap">
				{children}
			</BubbleContent>
		</Bubble>
	);
}
