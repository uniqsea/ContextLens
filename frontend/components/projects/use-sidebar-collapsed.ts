import { useEffect, useState } from "react";
import {
	SIDEBAR_FOLD_ATTR as ATTR,
	SIDEBAR_FOLD_KEY as KEY,
} from "./sidebar-fold";

/**
 * Whether the project sidebar is folded away; remembered across pages and visits.
 * The fold itself is drawn from the attribute on <html>; this state only labels the toggle.
 */
export function useSidebarCollapsed() {
	const [collapsed, setCollapsed] = useState(false);
	useEffect(() => {
		setCollapsed(document.documentElement.hasAttribute(ATTR));
	}, []);
	function toggle() {
		const next = !document.documentElement.hasAttribute(ATTR);
		document.documentElement.toggleAttribute(ATTR, next);
		try {
			localStorage.setItem(KEY, next ? "1" : "0");
		} catch {
			// Without browser storage the choice lasts until the page reloads.
		}
		setCollapsed(next);
	}
	return [collapsed, toggle] as const;
}
