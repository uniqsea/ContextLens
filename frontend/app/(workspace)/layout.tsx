"use client";

import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectSidebar } from "@/components/projects/sidebar";
import {
	DirectoryContext,
	useDirectory,
} from "@/components/projects/use-directory";
import { SidebarProvider } from "@/components/ui/sidebar";
import "@/components/projects/workspace.css";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
	const { scope } = useParams<{ scope?: string }>();
	const path = usePathname();
	const directory = useDirectory(scope);
	return (
		<SidebarProvider className="lens-page pr-workspace">
			<ProjectSidebar
				scope={scope}
				library={path === "/memories"}
				projects={directory.projects}
			/>
			<DirectoryContext.Provider value={directory}>
				{children}
			</DirectoryContext.Provider>
		</SidebarProvider>
	);
}
