import { createClient } from "@rivetkit/worker/client";
import { createReactRivetKit } from "@rivetkit/react";
import { useState, useEffect } from "react";
import type { Registry } from "../workers/registry";
import type { StreamState } from "./actor"; // Import shared types from actor

const client = createClient<Registry>("http://localhost:6420");
const { useActor, useActorEvent } = createReactRivetKit(client);

export function StreamExample() {
  const [{ actor }] = useActor("streamProcessor");
  const [topValues, setTopValues] = useState<number[]>([]);
  const [newValue, setNewValue] = useState<number>(0);

  // Load initial values
  useEffect(() => {
    if (actor) {
      actor.getTopValues().then(setTopValues);
    }
  }, [actor]);

  // Listen for updates from other clients
  useActorEvent({ actor, event: "updated" }, ({ topValues }) => {
    setTopValues(topValues);
  });

  // Add a new value to the stream
  const handleAddValue = () => {
    if (actor) {
      actor.addValue(newValue).then(setTopValues);
      setNewValue(0);
    }
  };

  return (
    <div>
      <h2>Top 3 Values</h2>
      
      <ul>
        {topValues.map((value, i) => (
          <li key={i}>{value}</li>
        ))}
      </ul>

      <input
        type="number"
        value={newValue}
        onChange={(e) => setNewValue(Number(e.target.value))}
      />
      <button onClick={handleAddValue}>Add Value</button>
    </div>
  );
}
