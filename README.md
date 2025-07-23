<!-- 
THIS FILE IS AUTO-GENERATED. DO NOT EDIT DIRECTLY.
To update this README, run: npm run gen:readme in the github.com/rivet-gg/rivet repository
Generated from: github.com/rivet-gg/rivet/site/scripts/generateReadme.mjs
-->

<div align="center">
  <a href="https://rivetkit.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./.github/media/logo/dark.svg" alt="RivetKit">
      <img src="./.github/media/logo/light.svg" alt="RivetKit" height="75">
    </picture>
  </a>
  <br/>
  <br/>
  <p><b>The open-source alternative to Durable Objects</b></p>
  <p>
    RivetKit is a library for long-lived processes with durable state, realtime, and scalability.<br/>
	Easily <u>self-hostable</u> and works <u>with your infrastructure</u>.
  </p>
  <p>
    <a href="https://rivet.gg/docs/actors/quickstart">Quickstart</a> •
    <a href="https://rivet.gg/docs/actors">Documentation</a> •
    <a href="https://rivet.gg/docs/general/self-hosting">Self-Hosting</a> •
    <a href="https://rivet.gg/discord">Discord</a> •
    <a href="https://x.com/rivet_gg">X</a> •
    <a href="https://bsky.app/profile/rivet.gg">Bluesky</a>
  </p>
  <p>
    <i>
      Supports <a href="https://rivetkit.org/actors/quickstart-backend">Node.js</a>, <a href="https://rivetkit.org/actors/quickstart-backend">Bun</a>, <a href="https://rivetkit.org/drivers/redis">Redis</a>, <a href="https://rivetkit.org/drivers/cloudflare-workers">Cloudflare</a>,<br/>
      <a href="https://rivetkit.org/clients/react">React</a>, <a href="https://rivetkit.org/clients/rust">Rust</a>, <a href="https://rivetkit.org/integrations/hono">Hono</a>, <a href="https://rivetkit.org/integrations/express">Express</a>, <a href="https://rivetkit.org/integrations/trpc">tRPC</a>, and <a href="https://rivetkit.org/integrations/better-auth">Better Auth</a>.
    </i>
  </p>
</div>

## Projects

Public-facing projects:

- **RivetKit** (you are here): Lightweight TypeScript library for building Rivet Actors
- **[Rivet Engine](https://github.com/rivet-gg/rivet)** : Engine that powers Rivet Actors at scale — completely optional
- **[Rivet Studio](https://github.com/rivet-gg/rivet/tree/main/frontend/apps/studio)**: Like Postman, but for Rivet Actors
- **[Rivet Documentation](https://github.com/rivet-gg/rivet/tree/main/site/src/content/docs)**

## Get Started

### Guides

Get started with Rivet by following a quickstart guide:

- [Node.js & Bun](https://www.rivet.gg/docs/actors/quickstart/backend/)
- [React](https://www.rivet.gg/docs/actors/quickstart/react/)


### Quickstart

**Step 1**: Install RivetKit

```sh
npm install @rivetkit/actor
```

**Step 2**: Create an actor

```typescript
// registry.ts
import { actor, setup } from "@rivetkit/actor";

export const counter = actor({
	state: { count: 0 },
	actions: {
		increment: (c, amount: number = 1) => {
			// State changes are durable & automatically persisted
			c.state.count += amount;
			// Broadcast realtime events
			c.broadcast("countChanged", c.state.count);
			// Return data to client
			return c.state.count;
		},
		getCount: (c) => c.state.count,
	},
});

export const registry = setup({
	use: { counter },
});
```

Read more about [state](https://www.rivet.gg/docs/actors/state/), [actions](https://www.rivet.gg/docs/actors/actions/), and [events](https://www.rivet.gg/docs/actors/events/).

**Step 2**: Setup server

_Alternatively, see the [React](https://www.rivet.gg/docs/actors/quickstart/react/) guide which does not require a server._

```typescript
// server.ts
import { registry } from "./registry";
import { Hono } from "hono";

// Start with file system driver for development
const { client, serve } = registry.createServer();

// Setup your server
const app = new Hono();

app.post("/increment/:name", async (c) => {
	const name = c.req.param("name");

	// Get or create actor with key `name`
	const counter = client.counter.getOrCreate(name);

	// Call an action
	const newCount = await counter.increment(1);

	return c.json({ count: newCount });
});

// Start server with Rivet
serve(app);
```

Start the server with:

```typescript
npx tsx server.ts
// or
bun server.ts
```

Read more about [clients](https://www.rivet.gg/docs/actors/clients/).

You can connect to your server with:

```typescript
// client.ts
const response = await fetch("http://localhost:8080/increment/my-counter", { method: "POST" });
const result = await response.json();
console.log("Count:", result.count); // 1
```

**Step 3**: Deploy

To scale Rivet in production, follow a guide to deploy to a hosting provider or integrate a driver:

- [Redis](https://www.rivet.gg/docs/drivers/redis/)
- [Cloudflare Workers](https://www.rivet.gg/docs/hosting-providers/cloudflare-workers/)

## Features

RivetKit provides everything you need to build fast, scalable, and real-time applications without the complexity.

- **Long-Lived, Stateful Compute**: Like AWS Lambda but with memory and no timeouts
- **Blazing-Fast Reads & Writes**: State stored on same machine as compute  
- **Realtime, Made Simple**: Built-in WebSockets and SSE support
- **Store Data Near Your Users**: Deploy to the edge for low-latency access
- **Infinitely Scalable**: Auto-scale from zero to millions without configuration
- **Fault Tolerant**: Automatic error handling and recovery built-in

## Examples

- AI Agent — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/ai-agent) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/ai-agent)
- Chat Room — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/chat-room) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/chat-room)
- Collab (Yjs) — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/crdt) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/crdt)
- Multiplayer Game — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/game) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/game)
- Local-First Sync — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/sync) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/sync)
- Rate Limiter — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/rate) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/rate)
- Per-User DB — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/database) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/database)
- Multi-Tenant SaaS — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/tenant) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/tenant)
- Stream Processing — [GitHub](https://github.com/rivet-gg/rivetkit/tree/main/examples/stream) · [StackBlitz](https://stackblitz.com/github/rivet-gg/rivetkit/tree/main/examples/stream)

## Runs Anywhere

Deploy RivetKit anywhere - from serverless platforms to your own infrastructure with RivetKit's flexible runtime options. Don't see the runtime you want? [Add your own](https://rivetkit.org/drivers/build).

### All-In-One
- <img src=".github/media/platforms/rivet-white.svg" height="16" alt="Rivet" />&nbsp;&nbsp;[Rivet](https://rivetkit.org/drivers/rivet)
- <img src=".github/media/platforms/cloudflare-workers.svg" height="16" alt="Cloudflare Workers" />&nbsp;&nbsp;[Cloudflare Workers](https://rivetkit.org/drivers/cloudflare-workers)

### Compute
- <img src=".github/media/platforms/vercel.svg" height="16" alt="Vercel" />&nbsp;&nbsp;[Vercel](https://github.com/rivet-gg/rivetkit/issues/897) *(On The Roadmap)*
- <img src=".github/media/platforms/aws-lambda.svg" height="16" alt="AWS Lambda" />&nbsp;&nbsp;[AWS Lambda](https://github.com/rivet-gg/rivetkit/issues/898) *(On The Roadmap)*
- <img src=".github/media/platforms/supabase.svg" height="16" alt="Supabase" />&nbsp;&nbsp;[Supabase](https://github.com/rivet-gg/rivetkit/issues/905) *(Help Wanted)*
- <img src=".github/media/platforms/bun.svg" height="16" alt="Bun" />&nbsp;&nbsp;[Bun](https://rivetkit.org/actors/quickstart-backend)
- <img src=".github/media/platforms/nodejs.svg" height="16" alt="Node.js" />&nbsp;&nbsp;[Node.js](https://rivetkit.org/actors/quickstart-backend)

### Storage
- <img src=".github/media/platforms/redis.svg" height="16" alt="Redis" />&nbsp;&nbsp;[Redis](https://rivetkit.org/drivers/redis)
- <img src=".github/media/platforms/postgres.svg" height="16" alt="Postgres" />&nbsp;&nbsp;[Postgres](https://github.com/rivet-gg/rivetkit/issues/899) *(Help Wanted)*
- <img src=".github/media/platforms/file-system.svg" height="16" alt="File System" />&nbsp;&nbsp;[File System](https://rivetkit.org/drivers/file-system)
- <img src=".github/media/platforms/memory.svg" height="16" alt="Memory" />&nbsp;&nbsp;[Memory](https://rivetkit.org/drivers/memory)

## Works With Your Tools

Seamlessly integrate RivetKit with your favorite frameworks, languages, and tools. Don't see what you need? [Request an integration](https://github.com/rivet-gg/rivetkit/issues/new).

### Frameworks
- <img src=".github/media/clients/react.svg" height="16" alt="React" />&nbsp;&nbsp;[React](https://rivetkit.org/clients/react)
- <img src=".github/media/clients/nextjs.svg" height="16" alt="Next.js" />&nbsp;&nbsp;[Next.js](https://github.com/rivet-gg/rivetkit/issues/904) *(Help Wanted)*
- <img src=".github/media/clients/vue.svg" height="16" alt="Vue" />&nbsp;&nbsp;[Vue](https://github.com/rivet-gg/rivetkit/issues/903) *(Help Wanted)*

### Clients
- <img src=".github/media/clients/javascript.svg" height="16" alt="JavaScript" />&nbsp;&nbsp;[JavaScript](https://rivetkit.org/clients/javascript)
- <img src=".github/media/clients/typescript.svg" height="16" alt="TypeScript" />&nbsp;&nbsp;[TypeScript](https://rivetkit.org/clients/javascript)
- <img src=".github/media/clients/python.svg" height="16" alt="Python" />&nbsp;&nbsp;[Python](https://github.com/rivet-gg/rivetkit/issues/902) *(Help Wanted)*
- <img src=".github/media/clients/rust.svg" height="16" alt="Rust" />&nbsp;&nbsp;[Rust](https://github.com/rivet-gg/rivetkit/issues/901) *(Help Wanted)*

### Integrations
- <img src=".github/media/integrations/hono.svg" height="16" alt="Hono" />&nbsp;&nbsp;[Hono](https://rivetkit.org/integrations/hono)
- <img src=".github/media/integrations/vitest.svg" height="16" alt="Vitest" />&nbsp;&nbsp;[Vitest](https://rivetkit.org/general/testing)
- <img src=".github/media/integrations/better-auth.svg" height="16" alt="Better Auth" />&nbsp;&nbsp;[Better Auth](https://rivetkit.org/integrations/better-auth)
- <img src=".github/media/platforms/vercel.svg" height="16" alt="AI SDK" />&nbsp;&nbsp;[AI SDK](https://github.com/rivet-gg/rivetkit/issues/907) *(On The Roadmap)*

### Local-First Sync
- <img src=".github/media/integrations/livestore.svg" height="16" alt="LiveStore" />&nbsp;&nbsp;[LiveStore](https://github.com/rivet-gg/rivetkit/issues/908) *(Available In July)*
- <img src=".github/media/integrations/zerosync.svg" height="16" alt="ZeroSync" />&nbsp;&nbsp;[ZeroSync](https://github.com/rivet-gg/rivetkit/issues/909) *(Help Wanted)*
- <img src=".github/media/integrations/tinybase.svg" height="16" alt="TinyBase" />&nbsp;&nbsp;[TinyBase](https://github.com/rivet-gg/rivetkit/issues/910) *(Help Wanted)*
- <img src=".github/media/integrations/yjs.svg" height="16" alt="Yjs" />&nbsp;&nbsp;[Yjs](https://github.com/rivet-gg/rivetkit/issues/911) *(Help Wanted)*

## Local Development with the Studio

Rivet Studio is like like Postman, but for all of your stateful serverless needs:

- **Live State Inspection**: View and edit your actor state in real-time as messages are sent and processed
- **REPL**: Debug your actor in real-time - call actions, subscribe to events, and interact directly with your code
- **Connection Inspection**: Monitor active connections with state and parameters for each client
- **Hot Reload Code Changes**: See code changes instantly without restarting - modify and test on the fly

[Visit the Studio →](https://studio.rivet.gg)

![Rivet Studio](.github/media/screenshots/studio/simple.png)

## Community & Support

Join thousands of developers building with RivetKit today:

- [Discord](https://rivet.gg/discord) - Chat with the community
- [X/Twitter](https://x.com/rivet_gg) - Follow for updates
- [Bluesky](https://bsky.app/profile/rivet.gg) - Follow for updates
- [GitHub Discussions](https://github.com/rivet-gg/rivetkit/discussions) - Ask questions and share ideas
- [GitHub Issues](https://github.com/rivet-gg/rivetkit/issues) - Report bugs and request features
- [Talk to an engineer](https://rivet.gg/talk-to-an-engineer) - Discuss your technical needs, current stack, and how Rivet can help with your infrastructure challenges

## License

[Apache 2.0](LICENSE)


