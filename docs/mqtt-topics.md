# MQTT Topics

## Core Topics

| Topic | Description |
|-------|-------------|
| `/t_ms` | Main message sync topic |
| `/orca_presence` | User presence updates |
| `/send_message2` | Send message channel |
| `/thread_typing` | Typing indicators |
| `/orca_typing_notifications` | Typing notifications |
| `/inbox` | Inbox updates |
| `/mark_thread` | Mark thread as read/unread |
| `/delete_messages` | Message deletion events |
| `/unsent_message` | Unsent/recalled messages |

## Event Types

- `message` - New incoming message
- `read_receipt` - Message read confirmation
- `typing` - User is typing
- `presence` - Online/offline status
- `thread_update` - Thread metadata changes
- `participant_update` - Thread member changes
