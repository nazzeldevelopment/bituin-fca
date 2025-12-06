# Changelog

All notable changes to Bituin-FCA will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2025-12-06

### Added
- **AntiBanManager** - Complete anti-ban system with:
  - Request throttling with intelligent delays
  - User-Agent rotation with realistic browser fingerprints
  - Human-like behavior simulation (random delays, mouse patterns)
  - Checkpoint detection and handling
  - Account health monitoring
  - Automatic cooldown on suspicious activity
  - Device fingerprint rotation
  - Request pattern randomization

- **LoginManager** - Full authentication system with:
  - Email/password login with form field extraction
  - Two-factor authentication (2FA) support
  - Checkpoint/security check handling
  - CAPTCHA detection and notification
  - Session token extraction
  - Automatic cookie management
  - Login attempt rate limiting

- **SessionManager** - Advanced session handling:
  - Session encryption with AES-256
  - Automatic session refresh
  - Session validation and health checks
  - Multi-session support
  - Session export/import
  - Automatic expiry detection

- **MQTTClient** - Full real-time messaging:
  - Binary protocol parsing (Facebook's custom format)
  - Topic subscription management
  - Message acknowledgment
  - Presence tracking
  - Typing indicators
  - Read receipts
  - Automatic reconnection with exponential backoff

- **GraphQLClient** - Complete GraphQL integration:
  - Query caching with TTL
  - Automatic retry with backoff
  - Batch request support
  - Response parsing and error handling
  - Doc ID management
  - Variable serialization

- **MessageSender** - Robust message sending:
  - Message queue with priority
  - Automatic retry on failure
  - Attachment handling (images, files, audio, video)
  - Mention support
  - Reply support
  - Sticker sending
  - Message scheduling

- **ThreadManager** - Full thread operations:
  - Create group threads
  - Add/remove participants
  - Change thread name/emoji/image
  - Mute/unmute threads
  - Leave threads
  - Archive/unarchive
  - Thread color customization

- **UserManager** - Complete user management:
  - Get user info
  - Block/unblock users
  - Friend request handling
  - Profile picture fetching
  - User search
  - Friendship status

- **ReactionManager** - Message reactions:
  - Add/remove reactions
  - Get reaction list
  - Reaction event handling

- **TypingIndicator** - Typing status:
  - Send typing indicator
  - Receive typing events
  - Typing timeout handling

- **ReadReceiptManager** - Read status:
  - Mark messages as read
  - Mark threads as seen
  - Read receipt events

- **EventSystem** - Comprehensive event handling:
  - Message events
  - Typing events
  - Presence events
  - Read receipt events
  - Thread update events
  - User update events

- **RateLimiter** - Advanced rate limiting:
  - Sliding window algorithm
  - Per-endpoint rate limits
  - Burst handling
  - Automatic recovery

- **CooldownManager** - Smart cooldowns:
  - Per-user cooldowns
  - Per-command cooldowns
  - Global cooldowns
  - Cooldown bypass for admins

### Changed
- Enhanced Logger with more emoji indicators and color schemes
- Improved error handling across all modules
- Better TypeScript type definitions

### Security
- Added request signing
- Implemented anti-fingerprinting measures
- Added checkpoint bypass mechanisms

---

## [0.1.0] - 2025-12-06

### Added
- Initial project structure
- Basic RequestBuilder
- Basic LoginManager skeleton
- Basic SessionManager skeleton
- Basic GraphQLClient skeleton
- Basic MQTTClient skeleton
- Basic UploadManager
- MessageParser and MessageHandler
- PluginLoader and CommandLoader
- RateLimiter and CooldownManager
- Logger with chalk colors
- Example plugin and ping command
- TypeScript configuration
- Documentation (api-map.md, mqtt-topics.md, endpoints.md)

---

## Roadmap

### [0.3.0] - Planned
- [ ] Polls and voting
- [ ] Message forwarding
- [ ] Voice/video call detection
- [ ] Story/status viewing
- [ ] Payment detection
- [ ] Live location sharing
- [ ] Vanish mode support

### [0.4.0] - Planned
- [ ] Web dashboard
- [ ] REST API server
- [ ] Webhook support
- [ ] Database migrations
- [ ] Admin panel
