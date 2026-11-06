"use client";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				// Primary: ink pill.
				default: "bg-primary text-primary-foreground hover:bg-primary/85",
				// Secondary: grey pill, or a transparent pill with a 1px line.
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-muted-strong hover:text-foreground data-popup-open:bg-muted-strong aria-pressed:bg-primary aria-pressed:text-primary-foreground",
				outline:
					"border border-border bg-transparent text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
				// Irreversible actions only: a red-lettered outline, or solid red to confirm.
				danger:
					"border border-border bg-transparent text-destructive hover:bg-destructive/10",
				destructive: "bg-destructive text-card hover:bg-destructive/88",
				// Quiet: no fill until hovered; text buttons and 32px round icon buttons.
				quiet:
					"text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
				ghost:
					"hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				// A small pill: actions inside a row or a card.
				chip: "h-7 gap-1.5 px-3 text-[12.5px] has-[>svg]:px-2.5",
				xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				icon: "size-9",
				"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		compoundVariants: [
			{
				variant: ["default", "secondary", "outline", "danger", "destructive"],
				className:
					"rounded-full text-[13px] tracking-[-0.01em] [&_svg:not([class*='size-'])]:size-[15px]",
			},
			{
				variant: ["default", "secondary", "outline", "danger", "destructive"],
				size: "chip",
				className: "text-[12.5px]",
			},
			{ variant: "quiet", className: "rounded-full text-[13px]" },
			{ variant: "quiet", size: "sm", className: "px-[11px]" },
		],
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
