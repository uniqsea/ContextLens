const conversationUrl = (id: string) =>
	`/api/lens/conversations/${encodeURIComponent(id)}`;

async function update(
	id: string,
	change: { title: string } | { archived: boolean },
) {
	const res = await fetch(conversationUrl(id), {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(change),
	});
	if (!res.ok) throw new Error("Conversation could not be updated");
}

export function renameConversation(id: string, title: string) {
	return update(id, { title });
}

export function setConversationArchived(id: string, archived: boolean) {
	return update(id, { archived });
}

export async function deleteConversation(id: string) {
	const res = await fetch(conversationUrl(id), { method: "DELETE" });
	if (!res.ok && res.status !== 404)
		throw new Error("Conversation could not be deleted");
}
