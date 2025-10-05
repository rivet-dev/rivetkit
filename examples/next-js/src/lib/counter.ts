declare global {
	// eslint-disable-next-line no-var
	var _counter: { value: number } | undefined;
}

// one shared object, cached on globalThis in dev
export const counter = global._counter ?? { value: 0 };

if (process.env.NODE_ENV !== "production") {
	global._counter = counter;
}
