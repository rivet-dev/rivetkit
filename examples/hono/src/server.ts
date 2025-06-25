// import { registry } from "./registry";
// import { Hono } from "hono";
// import { serve } from "@hono/node-server";
// import { createMemoryDriver } from "@rivetkit/memory";
//
// // Start RivetKit
// const { client, hono } = registry.server({
// 	driver: createMemoryDriver(),
// });
//
// // Setup router
// const app = new Hono();
//
// // Expose RivetKit to the frontend (optinoal)
// app.route("/registry", hono);
//
// // Example HTTP endpoint
// app.post("/increment/:name", async (c) => {
// 	const name = c.req.param("name");
//
// 	const counter = client.counter.getOrCreate(name);
// 	const newCount = await counter.increment(1);
//
// 	return c.text(`New Count: ${newCount}`);
// });
//
// serve({ fetch: app.fetch, port: 6420 }, (x) =>
// 	console.log("Listening at http://localhost:6420"),
// );
