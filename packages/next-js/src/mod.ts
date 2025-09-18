import type { Registry, RunConfigInput } from "rivetkit";

export const toNextHandler = (
	registry: Registry<any>,
	inputConfig: RunConfigInput = {},
) => {
	// Don't run server locally since we're using the fetch handler directly
	inputConfig.disableServer = true;
	inputConfig.disableActorDriver = true;

	const { fetch } = registry.startServerless(inputConfig);

	const fetchWrapper = async (
		request: Request,
		{ params }: { params: Promise<{ all: string[] }> },
	) => {
		const { all } = await params;

		const newUrl = new URL(request.url);
		newUrl.pathname = all.join("/");
		const newReq = new Request(newUrl, request);

		return await fetch(newReq);
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
