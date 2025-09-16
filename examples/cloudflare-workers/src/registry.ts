import { actor, setup } from "rivetkit";

export const counter = actor({
	state: { count: 0, connectionCount: 0, messageCount: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("foo", 1);
			return c.state.count;
		},
	},
});

export const registry = setup({
	use: { counter },
});
