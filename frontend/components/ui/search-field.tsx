import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";

import { cn } from "@/lib/utils";

export function SearchField({
	label,
	onValueChange,
	className,
	onChange,
	...inputProps
}: ComponentProps<"input"> & {
	label: string;
	onValueChange?: (value: string) => void;
}) {
	return (
		<InputGroup
			className={cn(
				"has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-foreground/60",
				className,
			)}
		>
			<InputGroupInput
				type="search"
				aria-label={label}
				placeholder={label}
				{...inputProps}
				onChange={(event) => {
					onChange?.(event);
					onValueChange?.(event.target.value);
				}}
			/>
			<InputGroupAddon>
				<Search aria-hidden="true" />
			</InputGroupAddon>
		</InputGroup>
	);
}
