# Freestyle Deployment for RivetKit

Example project demonstrating serverless deployment of RivetKit actors to [Freestyle](https://freestyle.sh) with [RivetKit](https://rivetkit.org).

### Durable State on Serverless — How does this work?
Serverless deployments of RivetKit leverage the combination of Freestyle's serverless infrastructure with Rivet Engine's ability to manage actor runners. This enables the development of stateful applications while still getting the quick startup and low latency of serverless.

[Learn More →](https://github.com/rivet-dev/rivetkit)

[Discord](https://rivet.dev/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-dev/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- Deno (for development)

Note: Deno is required since Freestyle uses Deno for their Web Deployments under the hood

### Installation

```sh
git clone https://github.com/rivet-dev/rivetkit
cd rivetkit/examples/freestyle
pnpm install
```

### Development

```sh
pnpm run dev
```

Open your browser to `http://localhost:5173` to see the application.

### Deploy

```sh
pnpm run deploy
```

And connect with
```sh
pnpm run dev:cli
```

## License

Apache 2.0