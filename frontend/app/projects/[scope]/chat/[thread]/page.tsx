import { LensApp } from "@/components/lens/lens-app";
import { checkThread, projectName } from "@/lib/projects/server";

export default async function ChatPage({
	params,
}: {
	params: Promise<{ scope: string; thread: string }>;
}) {
	const { scope, thread } = await params;
	const [name, title] = await Promise.all([
		projectName(scope),
		checkThread(scope, thread),
	]);
	return (
		<LensApp
			key={thread}
			scope={scope}
			name={name}
			threadId={thread}
			initialTitle={title}
		/>
	);
}
