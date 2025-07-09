# Chat Room for RivetKit

Example project demonstrating real-time messaging and actor state management with [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/chat-room
npm install
```

### Development

#### Web UI
Start the development server with both backend and React frontend:

```sh
npm run dev
```

Open your browser to `http://localhost:3000` to use the web chat interface.

#### CLI Interface
Alternatively, use the CLI interface:

```sh
npm run dev:cli
```

Or connect programmatically:

```sh
tsx src/scripts/connect.ts
```

## Features

- Real-time messaging with automatic persistence
- Multiple chat rooms support
- Both web and CLI interfaces
- Event-driven architecture with RivetKit actors
- TypeScript support throughout

## License

Apache 2.0