import { actor, setup } from "rivetkit";

export type CursorPosition = {
	userId: string;
	x: number;
	y: number;
	timestamp: number;
};

export type TextLabel = {
	id: string;
	userId: string;
	text: string;
	x: number;
	y: number;
	timestamp: number;
};

export const cursorRoom = actor({
	// Persistent state that survives restarts: https://rivet.dev/docs/actors/state
	state: {
		cursors: {} as Record<string, CursorPosition>,
		textLabels: [] as TextLabel[],
	},

	actions: {
		// Update cursor position
		updateCursor: (c, userId: string, x: number, y: number) => {
			const cursor: CursorPosition = { userId, x, y, timestamp: Date.now() };
			c.state.cursors[userId] = cursor;
			// Send events to all connected clients: https://rivet.dev/docs/actors/events
			c.broadcast("cursorMoved", cursor);
			return cursor;
		},

		// Place text on the canvas
		placeText: (c, userId: string, text: string, x: number, y: number) => {
			const textLabel: TextLabel = {
				id: `${userId}-${Date.now()}`,
				userId,
				text,
				x,
				y,
				timestamp: Date.now(),
			};
			c.state.textLabels.push(textLabel);
			c.broadcast("textPlaced", textLabel);
			return textLabel;
		},

		// Get all cursors
		getCursors: (c) => c.state.cursors,

		// Get all text labels
		getTextLabels: (c) => c.state.textLabels,

		// Remove cursor when user disconnects
		removeCursor: (c, userId: string) => {
			delete c.state.cursors[userId];
			c.broadcast("cursorRemoved", userId);
		},
	},
});

// Register actors for use: https://rivet.dev/docs/setup
export const registry = setup({
	use: { cursorRoom },
});
