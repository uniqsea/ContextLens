"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
	return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
	return (
		<CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
	);
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
	return (
		<CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
	);
}

/** Goes inside a CollapsibleTrigger: points right when closed, down when open. */
function CollapsibleChevron({
	className,
	...props
}: React.ComponentProps<typeof ChevronRightIcon>) {
	return (
		<ChevronRightIcon
			aria-hidden
			data-slot="collapsible-chevron"
			className={cn(
				"shrink-0 transition-transform in-data-panel-open:rotate-90",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Collapsible,
	CollapsibleChevron,
	CollapsibleContent,
	CollapsibleTrigger,
};
