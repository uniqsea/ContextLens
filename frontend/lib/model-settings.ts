/** Client for the agent's model settings (/lens/settings, reached through the same-origin proxy). */

export type Role = "agent" | "memory" | "embedding";
export interface ProviderRow {
	id: string;
	name: string;
	base_url: string | null;
	default_base_url: string | null;
	doc: string | null;
	connected: boolean;
	model_count: number;
}

export interface Overview {
	providers: ProviderRow[];
	roles: Record<Role, string | null>;
	/** Reasoning effort per role; applied only where the role's model takes it. */
	efforts: Partial<Record<Role, string>>;
}

export interface ModelInfo {
	id: string;
	name: string;
	kind: "chat" | "embedding";
	family: string | null;
	release_date: string | null;
	/** Newest of its family and recent; pickers lead with these, the rest come up when searched. */
	current: boolean;
	/** Offered in the picker: the user's choice for this provider, else the current models. */
	shown: boolean;
	reasoning: boolean;
	/** Effort levels the model takes, or null when it has no such setting. */
	efforts: string[] | null;
	context: number | null;
	cost_input: number | null;
	cost_output: number | null;
}

export type TestResult =
	| { ok: true; latency_ms: number }
	| { ok: false; error: string };

const BASE = "/api/lens/settings";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: init?.body ? { "Content-Type": "application/json" } : undefined,
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json() as Promise<T>;
}

export const settingsApi = {
	overview: () => call<Overview>(""),
	models: (provider: string) =>
		call<{ models: ModelInfo[] }>(`/providers/${provider}/models`).then(
			(r) => r.models,
		),
	saveProvider: (
		provider: string,
		body: { api_key?: string; base_url?: string },
	) =>
		call<Overview>(`/providers/${provider}`, {
			method: "PUT",
			body: JSON.stringify(body),
		}),
	setShown: (provider: string, models: string[] | null) =>
		call<{ models: ModelInfo[] }>(`/providers/${provider}/shown`, {
			method: "PUT",
			body: JSON.stringify({ models }),
		}).then((r) => r.models),
	forgetProvider: (provider: string) =>
		call<Overview>(`/providers/${provider}`, { method: "DELETE" }),
	setRoles: (roles: Partial<Record<Role, string | null>>) =>
		call<Overview>("/roles", { method: "PUT", body: JSON.stringify(roles) }),
	setEfforts: (efforts: Partial<Record<Role, string | null>>) =>
		call<Overview>("/efforts", {
			method: "PUT",
			body: JSON.stringify(efforts),
		}),
	test: (provider: string, model: string, kind: ModelInfo["kind"]) =>
		call<TestResult>("/test", {
			method: "POST",
			body: JSON.stringify({ provider, model, kind }),
		}),
};
