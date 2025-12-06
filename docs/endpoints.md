# Facebook Endpoints Documentation

## Authentication

### Login
```
POST https://www.facebook.com/login.php
Content-Type: application/x-www-form-urlencoded

email=<email>&pass=<password>&lsd=<token>&jazoest=<token>
```

## GraphQL API

### Endpoint
```
POST https://www.facebook.com/api/graphql/
Content-Type: application/x-www-form-urlencoded

doc_id=<query_id>&variables=<json>
```

### Common Doc IDs
- `6376629829043296` - Thread Messages Query
- `7222848254431650` - Thread Info Query
- `7242726912461752` - User Info Query

## Upload

### File Upload
```
POST https://upload.facebook.com/ajax/mercury/upload.php
Content-Type: multipart/form-data

file=<binary>
```

## MQTT WebSocket

### Connection
```
wss://edge-chat.facebook.com/chat?region=prn
Headers:
  Cookie: <session_cookies>
  User-Agent: <browser_ua>
```
