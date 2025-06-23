import { registry } from "./registry";
import express from "express";
import { createMemoryDriver } from "@rivetkit/memory";

// Start RivetKit
const { client, handler } = registry.run({
	driver: createMemoryDriver(),
});

// Setup router
const app = express();

// Expose RivetKit to the frontend (optional)
app.use("/registry", handler);

// Example HTTP endpoint
app.post("/increment/:name", async (req, res) => {
	const name = req.params.name;

	const counter = client.counter.getOrCreate(name);
	const newCount = await counter.increment(1);

	res.send(`New Count: ${newCount}`);
});

app.listen(6420, () => {
	console.log("Listening at http://localhost:6420");
});
