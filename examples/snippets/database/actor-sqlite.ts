import { actor } from "actor-core";
import { drizzle } from "@actor-core/drizzle";
import { notes } from "./schema";
import { authenticate } from "./my-utils";

export type Note = { id: string; content: string; updatedAt: number };

// User notes actor
const userNotes = actor({
  sql: drizzle(),
  
  // Authenticate
  createConnState: async (c, { params }) => {
    const token = params.token;
    const userId = await authenticate(token);
    return { userId };
  },

  actions: {
    // Get all notes
    getNotes: async (c) => {
      const result = await c.db
        .select()
        .from(notes);
      
      return result;
    },

    // Update note or create if it doesn't exist
    updateNote: async (c, { id, content }) => {
      // Ensure the note ID exists or create a new one
      const noteId = id || `note-${Date.now()}`;
      
      // Check if note exists
      const existingNote = await c.db
        .select()
        .from(notes)
        .where(notes.id.equals(noteId))
        .get();
      
      if (existingNote) {
        // Update existing note
        await c.db
          .update(notes)
          .set({
            content
          })
          .where(notes.id.equals(noteId));
        
        const updatedNote = {
          id: noteId,
          content
        };
        
        c.broadcast("noteUpdated", updatedNote);
        return updatedNote;
      } else {
        // Create new note
        const newNote = {
          id: noteId,
          content
        };
        
        await c.db
          .insert(notes)
          .values(newNote);
        
        c.broadcast("noteAdded", newNote);
        return newNote;
      }
    },

    // Delete note
    deleteNote: async (c, { id }) => {
      // Delete the note
      await c.db
        .delete(notes)
        .where(notes.id.equals(id));
      
      c.broadcast("noteDeleted", { id });
    }
  }
});

export default userNotes;