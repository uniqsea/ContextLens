"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

export interface MenuOption {
	value: string;
	label: string;
}

/** The select of this app: a pill that opens a short menu. `value` may be missing from `options`
 * (a saved model the catalog no longer lists); it still shows, under its own name. */
export function MenuSelect({
	label,
	value = "",
	options,
	placeholder,
	onChange,
	triggerClassName = "lens-select",
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
	const [open, setOpen] = useState(false);
	const shown =
		options.find((o) => o.value === value)?.label || value || placeholder;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger className={triggerClassName} aria-label={label}>
				<span>{shown}</span>
				{chevron && <ChevronDown aria-hidden="true" />}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				className="lens-theme lens-menu"
				// A menu opened from a dialog sits in a portal outside it; keep the wheel working.
				onWheel={(e) => e.stopPropagation()}
			>
				<div className="lens-menu-list">
					{options.map((o) => (
						<button
							key={o.value}
							type="button"
							className="lens-menu-item"
							aria-pressed={o.value === value}
							onClick={() => {
								setOpen(false);
								onChange(o.value);
							}}
						>
							{o.label}
							{o.value === value && <Check aria-hidden="true" />}
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
