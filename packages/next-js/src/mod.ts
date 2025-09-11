import { handle } from "hono/vercel";
import type { Registry } from "rivetkit";

export const toNextHandler = (
	server: ReturnType<Registry<any>["createServer"]>,
) => {
	const { hono: registryHono } = server;

	const handler = handle(registryHono);

	return {
		GET: handler,
		POST: handler,
		PATCH: handler,
		HEAD: handler,
		OPTIONS: handler,
	};
};
