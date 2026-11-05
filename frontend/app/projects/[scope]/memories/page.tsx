import { MemoryLibrary } from "@/components/memory-library";
import { projectName } from "@/lib/projects/server";

export default async function ProjectMemories({
	params,
}: {
	params: Promise<{ scope: string }>;
}) {
	const { scope } = await params;
	const name = await projectName(scope);
	return <MemoryLibrary key={scope} projectScope={scope} projectName={name} />;
}
