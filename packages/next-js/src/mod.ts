import type { Registry } from "rivetkit";

export const toNextHandler = (_server: ReturnType<Registry<any>["start"]>) => {
	// TODO:
	// const { hono: registryHono } = server;
	//
	// const handler = handle(registryHono);

	return {
		// GET: handler,
		// POST: handler,
		// PATCH: handler,
		// HEAD: handler,
		// OPTIONS: handler,
	};
};
