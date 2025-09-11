import { actor } from "rivetkit";

type ConnParams = { trackLifecycle?: boolean } | undefined;

export const counterWithLifecycle = actor({
	onAuth: () => {},
	state: {
		count: 0,
		events: [] as string[],
	},
	createConnState: (c, opts, params: ConnParams) => ({
		joinTime: Date.now(),
	}),
	onStart: (c) => {
		c.state.events.push("onStart");
	},
	onBeforeConnect: (c, opts, params: ConnParams) => {
		if (params?.trackLifecycle) c.state.events.push("onBeforeConnect");
	},
	onConnect: (c, conn) => {
		if (conn.params?.trackLifecycle) c.state.events.push("onConnect");
	},
	onDisconnect: (c, conn) => {
		if (conn.params?.trackLifecycle) c.state.events.push("onDisconnect");
	},
	actions: {
		getEvents: (c) => {
			return c.state.events;
		},
		increment: (c, x: number) => {
			c.state.count += x;
			return c.state.count;
		},
	},
});
