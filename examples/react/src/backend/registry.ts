import { actor, setup } from "@rivetkit/actor";

export const counter = actor({
	onAuth: () => {
		// Configure auth here
	},
	state: { count: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
	},
});

export const registry = setup({
	actors: { counter },
});

export type Registry = typeof registry;
