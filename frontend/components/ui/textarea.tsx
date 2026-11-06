import { cn } from "cn";
import type * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex field-sizing-content min-h-16 w-full rounded-[12px] bg-muted px-3 py-2 text-[13.5px] leading-normal text-foreground font-normal transition-shadow outline-none placeholder:text-muted-foreground focus-visible:ring-[1.5px] focus-visible:ring-inset focus-visible:ring-foreground/60 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[1.5px] aria-invalid:ring-inset aria-invalid:ring-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
