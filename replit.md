# Bituin-FCA V2 Ultra

## Overview
Bituin-FCA is an advanced, non-official Facebook Chat API library (FCA V1/V2 Ultra) built with TypeScript. It provides production-ready architecture with clear separation of concerns for core modules including Login, Session, MQTT, GraphQL, Upload, Thread/User management, Plugin/Command system, RateLimiter, Cooldown, and more.

## Project Structure

```
├── src/
│   ├── index.ts              # Main entry point
│   ├── core/                 # Core modules
│   │   ├── LoginManager.ts   # Authentication handling
│   │   ├── SessionManager.ts # Session persistence
│   │   ├── CookieManager.ts  # Cookie handling
│   │   ├── RequestBuilder.ts # HTTP request builder
│   │   ├── GraphQLClient.ts  # Facebook GraphQL API
│   │   ├── MQTTClient.ts     # Real-time messaging
│   │   ├── UploadManager.ts  # File uploads
│   │   ├── MessageParser.ts  # Message parsing
│   │   ├── MessageHandler.ts # Message handling
│   │   ├── ThreadManager.ts  # Thread management
│   │   ├── UserManager.ts    # User management
│   │   ├── RateLimiter.ts    # Rate limiting
│   │   ├── CooldownManager.ts # Cooldown system
│   │   ├── PluginLoader.ts   # Plugin system
│   │   ├── CommandLoader.ts  # Command system
│   │   └── Logger.ts         # Beautiful logging
│   ├── transports/           # HTTP and MQTT transports
│   ├── adapters/             # Storage adapters (JSON, Redis)
│   ├── plugins/              # Plugin directory
│   ├── commands/             # Command handlers
│   ├── types/                # TypeScript definitions
│   ├── utils/                # Helper utilities
│   └── tests/                # Test files
├── docs/                     # Documentation
├── package.json
└── tsconfig.json
```

## Development

- **Run dev mode**: `npm run dev` - Uses ts-node-dev with hot reload
- **Build**: `npm run build` - Compiles TypeScript to dist/
- **Run tests**: `npm test` - Runs Jest tests
- **Start production**: `npm start` - Runs compiled JavaScript

## Key Features

- 🔐 Session management with cookie persistence
- 📡 Real-time messaging via MQTT WebSocket
- 📊 GraphQL API integration
- 📁 File upload support
- 🔌 Plugin system for extensibility
- ⚡ Command handling with prefix support
- 🛡️ Rate limiting & cooldowns
- 📝 Beautiful colorful logging with chalk

## Dependencies

- axios - HTTP client
- ws - WebSocket client
- mqtt - MQTT protocol
- eventemitter3 - Event handling
- ioredis - Redis client
- dotenv - Environment variables
- chalk - Colorful logging
- form-data - File uploads

## Configuration

Create a `.env` file based on `.env.example`:
```
FB_EMAIL=your_email@example.com
FB_PASS=your_password
```

## Notes

This is a reverse-engineered client that mimics browser behaviour. Use at your own risk with dedicated accounts.
