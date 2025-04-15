import { createClient } from "actor-core/client";
import { createReactActorCore } from "@actor-core/react";
import { useState, useEffect } from "react";
import type { App } from "../actors/app";

const client = createClient<App>("http://localhost:6420");
const { useActor, useActorEvent } = createReactActorCore(client);

export function DocumentEditor() {
  // Connect to actor for this document ID from URL
  const documentId = new URLSearchParams(window.location.search).get('id') || 'default-doc';
  const [{ actor, connectionId }] = useActor("document", { tags: { id: documentId } });
  
  // Local state
  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [otherCursors, setOtherCursors] = useState({});
  
  // Load initial document state
  useEffect(() => {
    if (actor) {
      actor.getText().then(setText);
      actor.getCursors().then(setOtherCursors);
    }
  }, [actor]);
  
  // Listen for updates from other users
  useActorEvent({ actor, event: "textUpdated" }, ({ text: newText, userId: senderId }) => {
    if (senderId !== connectionId) setText(newText);
  });
  
  useActorEvent({ actor, event: "cursorUpdated" }, ({ userId: cursorUserId, x, y }) => {
    if (cursorUserId !== connectionId) {
      setOtherCursors(prev => ({
        ...prev,
        [cursorUserId]: { x, y, userId: cursorUserId }
      }));
    }
  });
  
  // Update cursor position
  const updateCursor = (e) => {
    if (!actor) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (x !== cursorPos.x || y !== cursorPos.y) {
      setCursorPos({ x, y });
      actor.updateCursor(x, y);
    }
  };
  
  return (
    <div className="document-editor">
      <h2>Document: {documentId}</h2>
      
      <div onMouseMove={updateCursor}>
        <textarea
          value={text}
          onChange={(e) => {
            const newText = e.target.value;
            setText(newText);
            actor?.setText(newText);
          }}
          placeholder="Start typing..."
        />
        
        {/* Other users' cursors */}
        {Object.values(otherCursors).map((cursor: any) => (
          <div 
            key={cursor.userId}
            style={{
              position: 'absolute',
              left: `${cursor.x}px`,
              top: `${cursor.y}px`,
              width: '10px',
              height: '10px',
              backgroundColor: 'red',
              borderRadius: '50%'
            }}
          />
        ))}
      </div>
      
      <div>
        <p>Connected users: You and {Object.keys(otherCursors).length} others</p>
      </div>
    </div>
  );
}