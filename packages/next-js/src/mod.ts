import type { Registry, RunConfigInput } from "rivetkit";

export const toNextHandler = (
	registry: Registry<any>,
	inputConfig: RunConfigInput = {},
) => {
	// Don't run server locally since we're using the fetch handler directly
	inputConfig.disableServer = true;

	const { fetch } = registry.start(inputConfig);

	return {
		GET: fetch,
		POST: fetch,
		PATCH: fetch,
		HEAD: fetch,
		OPTIONS: fetch,
	};
};
