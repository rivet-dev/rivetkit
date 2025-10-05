import { toNextHandler } from "@rivetkit/next-js";
import { registry } from "@/rivet/registry";

declare global {
	// eslint-disable-next-line no-var
	var _handlers: { value: any } | undefined;
}

// one shared object, cached on globalThis in dev
export const handlers = global._handlers ?? { value: toNextHandler(registry) };

if (process.env.NODE_ENV !== "production") {
	global._handlers = handlers;
}
