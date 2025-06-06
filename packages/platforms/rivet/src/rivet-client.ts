import { httpUserAgent } from "@rivetkit/actor/utils";

export interface RivetClientConfig {
	endpoint: string;
	token: string;
	project?: string;
	environment?: string;
}

export async function rivetRequest<RequestBody, ResponseBody>(
	config: RivetClientConfig,
	method: string,
	url: string,
	body?: RequestBody,
): Promise<ResponseBody> {
	const urlBuilder = new URL(url, config.endpoint);
	if (config.project) {
		urlBuilder.searchParams.append("project", config.project);
	}
	if (config.environment) {
		urlBuilder.searchParams.append("environment", config.environment);
	}

	const response = await fetch(urlBuilder, {
		method,
		headers: {
			"Content-Type": "application/json",
			"User-Agent": httpUserAgent(),
			Authorization: `Bearer ${config.token}`,
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		throw new Error(
			`Rivet API error (${response.status}, ${method} ${url}): ${errorData.message || response.statusText}`,
		);
	}

	return response.json();
}
