# SecureChat

SecureChat is a full-stack messaging app built with React, Node.js, MongoDB, and Socket.io.

It supports secure direct messaging, group conversations, file/photo sharing, and real-time voice/video calling signaling.

## Highlights
- JWT authentication with bcrypt password hashing
- Direct and group chats
- Real-time updates with Socket.io
- End-to-end encrypted direct messages
- File and image upload support
- Message receipts (sent, delivered, read)
- Reactions, replies, message edit/delete
- Chat pinning and disappearing messages (vanish mode)
- Locked private chats (password-gated)
- Voice/video calling (WebRTC signaling layer)
- Responsive WhatsApp-style UI

## Tech Stack
- Frontend: React 18, React Router 6, Socket.io client, Emoji Mart, React Icons
- Backend: Node.js, Express 4, Socket.io, MongoDB, Mongoose
- Security: JWT, bcryptjs, helmet, express-rate-limit, request payload key sanitization
- Uploads: multer

## Repository Structure
```text
backend/
  src/
    app.js                 # Express app + middleware + route mount
    index.js               # server bootstrap + Mongo connect + socket init
    middleware/            # auth + lock-password verification
    models/                # Mongoose schemas
    routes/                # auth/users/chats/messages/requests/upload/emojis
    socket/                # socket.io event handling
  tests/                   # node:test integration tests
  e2e/                     # API E2E script

frontend/
  src/
    components/            # chat UI components
    hooks/                 # call manager hooks
    pages/                 # page containers
    services/              # api/socket/storage/runtime config
    utils/                 # crypto + helpers
```

## Core Capabilities

### 1) Messaging
- 1:1 direct chat and group chat
- Live message delivery over socket rooms
- Read/delivered status updates
- Reply-to messages
- Reactions with live sync
- Edit window for recently sent messages
- Delete for me / delete for everyone

### 2) Encryption Model
- Direct messages are enforced as encrypted by backend validation
- Direct text and direct file/image payloads are encrypted in app flow
- Group messages are not end-to-end encrypted in current design

### 3) Media
- Image and file upload with server-side checks
- MIME and extension validation
- Upload size limits configurable via env
- Secure download endpoint with key validation to block traversal patterns

### 4) Calling
- Voice/video call signaling through Socket.io
- Room capacity guardrails
- Busy/offline handling
- WebRTC media negotiation handled on client side

### 5) Access and Privacy Controls
- Locked chats flow with password digest verification
- Vanish mode for disappearing messages after read-by-all
- Presence and typing indicators

## Important Note
- Voice message recording/playback is intentionally not included in the current build.

## Prerequisites
- Node.js 18+ recommended
- npm 9+
- MongoDB running locally or reachable via connection string

## Environment Variables

### Backend (`backend/.env`)
Copy `backend/.env.example` and fill values:

```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/secure-chat
JWT_SECRET=replace-with-a-strong-secret
CLIENT_ORIGIN=http://localhost:3000,http://localhost:5173
IMAGE_UPLOAD_MAX_MB=10
FILE_UPLOAD_MAX_MB=50
AUTH_RATE_LIMIT_MAX=40
API_RATE_LIMIT_PER_MIN=400
JSON_BODY_LIMIT=2mb
```

### Frontend (`frontend/.env`)
```env
REACT_APP_API_BASE=http://localhost:5001
REACT_APP_SOCKET_URL=http://localhost:5001
REACT_APP_TURN_URL=
REACT_APP_TURN_USERNAME=
REACT_APP_TURN_CREDENTIAL=
```

Notes:
- If `REACT_APP_SOCKET_URL` is empty, frontend falls back to `REACT_APP_API_BASE`.
- Runtime config remaps loopback URLs to current LAN hostname for easier local device testing.

## Local Development

### 1) Start Backend
```bash
cd backend
npm install
npm run dev
```

### 2) Start Frontend
```bash
cd frontend
npm install
npm run dev
```

Backend default: `http://localhost:5001`  
Frontend default: `http://localhost:3000`

## Scripts

### Backend
- `npm run dev` - run server with nodemon
- `npm start` - run production server
- `npm test` - run backend tests
- `npm run test:e2e` - run E2E API script

### Frontend
- `npm run dev` - start CRA dev server
- `npm run build` - production build
- `npm test` - frontend tests

## API Surface (High Level)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/users`
- `GET /api/chats`
- `POST /api/chats/group`
- `GET /api/messages/:chatId`
- `POST /api/messages/:chatId`
- `POST /api/messages/:chatId/read`
- `PATCH /api/messages/:messageId`
- `PATCH /api/messages/:messageId/reaction`
- `DELETE /api/messages/:messageId`
- `POST /api/upload`
- `GET /api/upload/:fileKey`

## Socket Events (High Level)
- Presence and typing:
  - `presence`
  - `typing`
- Messaging:
  - `message:new`
  - `message:read`
  - `message:delivered`
  - `message:updated`
  - `message:deleted`
  - `message:reaction`
- Calling/signaling:
  - `call-join` / `join-room`
  - `call-signal` / `signal`
  - `call-leave` / `leave-room`
  - `call-invite`
  - `incoming-call`
  - `call-accepted`
  - `call-rejected`
  - `end-call`

## Security and Hardening
- JWT validation on protected routes
- Auth and API rate limiting
- Request key sanitization (`$` and dotted keys blocked)
- Multer file-size limits and server-side file validation
- Safe file-key pattern checks for download route
- Express global error handling for cast/validation/upload failures

## Testing

### Backend Tests
```bash
cd backend
npm test
```
Current suite includes:
- API guardrails (validation and upload protections)
- Socket room-capacity signaling checks

### Frontend Tests
```bash
cd frontend
npm test -- --watchAll=false
```

## Deployment Notes
- Set a strong `JWT_SECRET`
- Lock down `CLIENT_ORIGIN` to production origins
- Configure MongoDB with authentication and network restrictions
- Use HTTPS in production
- Configure TURN server credentials for reliable call connectivity across NAT/firewalls

## License
Use and modify based on your project policy.
