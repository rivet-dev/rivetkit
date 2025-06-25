import { worker } from "@rivetkit/core";

export const counterWithParams = worker({
	onAuth: () => {},
	state: { count: 0, initializers: [] as string[] },
	createConnState: (c, { params }: { params: { name?: string } }) => {
		return {
			name: params?.name || "anonymous",
		};
	},
	onConnect: (c, conn) => {
		// Record connection name
		c.state.initializers.push(conn.state.name);
	},
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", {
				count: c.state.count,
				by: c.conn.state.name,
			});
			return c.state.count;
		},
		getInitializers: (c) => {
			return c.state.initializers;
		},
	},
});

