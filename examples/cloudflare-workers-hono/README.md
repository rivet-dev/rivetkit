# Cloudflare Workers with Hono for RivetKit

Example project demonstrating Cloudflare Workers deployment with Hono router using [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js
- Cloudflare account with Actors enabled
- Wrangler CLI installed globally (`npm install -g wrangler`)

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/cloudflare-workers-hono
npm install
```

### Development

```sh
npm run dev
```

This will start the Cloudflare Workers development server locally at http://localhost:8787.

### Testing the Application

You can test the Hono router endpoint by making a POST request to increment a counter:

```sh
curl -X POST http://localhost:8787/increment/my-counter
```

Or run the client script to interact with your actors:

```sh
npm run client
```

### Deploy to Cloudflare

First, authenticate with Cloudflare:

```sh
wrangler login
```

Then deploy:

```sh
npm run deploy
```

## License

Apache 2.0
