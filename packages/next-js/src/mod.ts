import type { Registry, RunConfigInput } from "rivetkit";

type RegistryInstance = {
	fetch: (request: Request) => Response | Promise<Response>;
};

const createRegistryInstance = (
	registry: Registry<any>,
	inputConfig: RunConfigInput = {},
): RegistryInstance => {
	console.log("=== CREATE NEXT HANDLER ===");

	// Don't run server locally since we're using the fetch handler directly
	inputConfig.disableDefaultServer = true;
	// inputConfig.disableActorDriver = true;

	// Next logs this on every request
	inputConfig.noWelcome = true;

	const { fetch } = registry.start(inputConfig);
	return { fetch };
};

declare global {
	// eslint-disable-next-line no-var
	var rivetRegistry: RegistryInstance | undefined;
}

export const toNextHandler = (
	registry: Registry<any>,
	inputConfig: RunConfigInput = {},
) => {
	console.log("=== CREATE REGISTRY INSTANCE ===");

	// Store registry instance globally to survive Next.js hot reloads in development.
	// Without this, the registry would reinitialize on every code change, losing actor state.
	const registryInstance =
		global.rivetRegistry ?? createRegistryInstance(registry, inputConfig);
	if (process.env.NODE_ENV !== "production") {
		global.rivetRegistry = registryInstance;
	}

	const fetchWrapper = async (
		request: Request,
		{ params }: { params: Promise<{ all: string[] }> },
	) => {
		const { all } = await params;

		const newUrl = new URL(request.url);
		newUrl.pathname = all.join("/");
		const newReq = new Request(newUrl, request);

		return await registryInstance.fetch(newReq);
	};

	return {
		GET: fetchWrapper,
		POST: fetchWrapper,
		PUT: fetchWrapper,
		PATCH: fetchWrapper,
		HEAD: fetchWrapper,
		OPTIONS: fetchWrapper,
	};
};
