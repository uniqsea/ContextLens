const threadUrl = (id: string) => `/api/threads/${encodeURIComponent(id)}`;

async function updateMetadata(
	id: string,
	metadata: { title: string } | { archived: boolean },
) {
	const res = await fetch(threadUrl(id), {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ metadata }),
	});
	if (!res.ok) throw new Error("Conversation could not be updated");
}

export function renameConversation(id: string, title: string) {
	return updateMetadata(id, { title });
}

export function setConversationArchived(id: string, archived: boolean) {
	return updateMetadata(id, { archived });
}

export async function deleteConversation(id: string) {
	const res = await fetch(threadUrl(id), { method: "DELETE" });
	if (!res.ok && res.status !== 404)
		throw new Error("Conversation could not be deleted");
}
