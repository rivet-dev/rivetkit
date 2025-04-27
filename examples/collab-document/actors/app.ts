import { actor, setup } from "actor-core";

export type Cursor = { x: number, y: number, userId: string };

export type CursorUpdateEvent = { userId: string, x: number, y: number };

export type TextUpdatedEvent = { text: string, userId: string };

export type UserDisconnectedEvent = { userId: string };

const document = actor({
  state: {
    text: "",
    cursors: {} as Record<string, Cursor>,
  },

  onDisconnect: (c, conn) => {
    console.log("onDisconnect(): " + conn.id);
    delete c.state.cursors[conn.id];
    
    // Broadcast removal
    c.broadcastWithOptions(
      { exclude: [conn.id] },
      "userDisconnected",
      {
        userId: conn.id
      } as UserDisconnectedEvent
    );
  },

  actions: {
    getText: (c) => c.state.text,

    // Update the document (real use case has better conflict resolution)
    setText: (c, text: string) => {
      // Save document state
      c.state.text = text;
      
      // Broadcast update
      c.broadcastWithOptions(
        { excludeSelf: true },
        "textUpdated", 
        {
          text,
          userId: c.conn.id
        } as TextUpdatedEvent
      );
    },

    getCursors: (c) => c.state.cursors,
    
    updateCursor: (c, x: number, y: number) => {
      console.log("updateCursor(): " + c.conn.id);
      // Update user location
      const userId = c.conn.id;
      c.state.cursors[userId] = { x, y, userId };
      
      // Broadcast location
      c.broadcastWithOptions(
        { excludeSelf: true },
        "cursorUpdated",
        {
          userId,
          x, 
          y
        } as CursorUpdateEvent
      );
    },
  }
});

// Create and export the app
export const app = setup({
  actors: { document }
});

// Export type for client type checking
export type App = typeof app; 
