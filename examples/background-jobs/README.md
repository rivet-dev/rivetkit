# Daily Email Campaign for RivetKit

Example project demonstrating scheduled background emails with [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-dev/rivetkit)

[Discord](https://rivet.dev/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-dev/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 20+
- [Resend](https://resend.com) API key and verified sender domain

### Installation

```sh
git clone https://github.com/rivet-dev/rivetkit
cd rivetkit/examples/background-jobs
npm install
```

### Development

```sh
RESEND_API_KEY=your-api-key \
RESEND_FROM_EMAIL="Example <hello@example.com>" \
CAMPAIGN_USER_EMAIL=user@example.com \
npm run dev
```

The example creates a single `emailCampaignUser` actor, stores the recipient email, and schedules a daily task that sends mail through the live Resend API. The server logs the next scheduled send time, and the actor reschedules itself after each successful delivery. Set `CAMPAIGN_USER_ID` to control the actor key when you need to track multiple users.

## License

Apache 2.0
