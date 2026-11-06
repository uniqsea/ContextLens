"use client";

import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface MenuOption {
	value: string;
	label: string;
}

/** The select of this app: a pill that opens a short menu. `value` may be missing from `options`
 * (a saved model the catalog no longer lists); it still shows, under its own name. */
export function MenuSelect({
	label,
	value,
	options,
	placeholder,
	onChange,
	triggerClassName,
	chevron = true,
}: {
	label: string;
	value?: string;
	options: MenuOption[];
	/** What the trigger says while nothing is chosen. */
	placeholder?: string;
	onChange: (value: string) => void;
	triggerClassName?: string;
	chevron?: boolean;
}) {
	const selected = options.find((option) => option.value === value);
	return (
		<Select
			items={options}
			value={value ?? null}
			onValueChange={(next) => {
				if (next !== null) onChange(next);
			}}
		>
			<SelectTrigger
				className={triggerClassName}
				aria-label={label}
				chevron={chevron}
			>
				<SelectValue placeholder={placeholder}>
					{selected?.label ?? (value || placeholder)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="start" sideOffset={6} alignItemWithTrigger={false}>
				<SelectGroup>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
