import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-9 w-full min-w-0 rounded-[12px] bg-muted px-3 py-1 text-[13.5px] text-foreground font-normal transition-shadow outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:ring-[1.5px] focus-visible:ring-inset focus-visible:ring-foreground/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[1.5px] aria-invalid:ring-inset aria-invalid:ring-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
