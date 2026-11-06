import { ProjectWorkspace } from "@/components/projects/workspace";

export default async function ProjectPage({
	params,
}: {
	params: Promise<{ scope: string }>;
}) {
	const { scope } = await params;
	return <ProjectWorkspace key={scope} scope={scope} />;
}
