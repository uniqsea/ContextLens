import { redirect } from "next/navigation";
import { projectPath } from "@/lib/projects/types";

export default async function ProjectMemories({
	params,
}: {
	params: Promise<{ scope: string }>;
}) {
	const { scope } = await params;
	redirect(`${projectPath(scope)}?tab=memories`);
}
