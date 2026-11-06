export const SIDEBAR_FOLD_KEY = "contextlens.sidebar-collapsed";
export const SIDEBAR_FOLD_ATTR = "data-sidebar-collapsed";

/** Runs in <head> before the first paint, so a folded sidebar never flashes open on load. */
export const sidebarFoldScript = `try{localStorage.getItem("${SIDEBAR_FOLD_KEY}")==="1"&&document.documentElement.setAttribute("${SIDEBAR_FOLD_ATTR}","")}catch(e){}`;
