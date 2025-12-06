# Bituin-FCA V1/V2 Ultra

Advanced Facebook Chat API library for Node.js/TypeScript.

## Features

- 🔐 Session management with cookie persistence
- 📡 Real-time messaging via MQTT WebSocket
- 📊 GraphQL API integration
- 📁 File upload support
- 🔌 Plugin system
- ⚡ Command handling
- 🛡️ Rate limiting & cooldowns
- 📝 Beautiful colorful logging

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Project Structure

```
src/
├── core/           # Core modules (Login, Session, MQTT, etc.)
├── transports/     # HTTP and MQTT transports
├── adapters/       # Storage adapters (JSON, Redis)
├── plugins/        # Plugin directory
├── commands/       # Command handlers
├── types/          # TypeScript definitions
├── utils/          # Helper utilities
└── tests/          # Test files
```

## Usage

```typescript
import { LoginManager, RequestBuilder, MQTTClient } from './src';

const req = new RequestBuilder();
const login = new LoginManager(req);
const mqtt = new MQTTClient();

// Login with email/password or load existing session
const session = await login.loginEmail({
  email: 'your@email.com',
  password: 'yourpassword'
});

// Connect to MQTT for real-time messages
mqtt.connect(req.getCookieHeader());
```

## License

Use at your own risk. Non-official clients may breach Facebook Terms of Service.
