# SecureChat

SecureChat is a React + Node.js messaging app with:
- JWT authentication
- 1:1 and group chats
- Socket.io realtime updates
- E2EE for direct messages
- File/photo sharing
- Voice/video calling (WebRTC signaling)
- Locked chats

## Tech Stack
- Frontend: React (CRA), React Router, Socket.io client
- Backend: Node.js, Express, Socket.io, MongoDB, Mongoose
- Auth: JWT + bcrypt
- Uploads: multer

## Project Structure
```text
backend/
  src/
    app.js
    index.js
    middleware/
    models/
    routes/
    socket/
  uploads/
  tests/
frontend/
  src/
    components/
    hooks/
    pages/
    services/
```

## Environment Variables

### Backend (`backend/.env`)
```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/secure-chat
JWT_SECRET=replace-with-strong-secret
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

## Run Locally

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Test Commands

### Backend
```bash
cd backend
npm test
```
Includes:
- API guardrail tests (validation/upload security)
- Socket signaling room-limit tests

### Frontend
```bash
cd frontend
npm test -- --watchAll=false
```
Includes:
- MessageInput behavior tests
- MessageList media rendering tests

## Build
```bash
cd frontend
npm run build
```

## Audit Repairs Included

### Backend
- Added centralized app bootstrap (`backend/src/app.js`)
- Added `helmet`, API/auth rate limiting, and request key sanitization
- Added global async error handling (CastError/ValidationError/file-size handling)
- Hardened upload download route against invalid keys/path traversal
- Strengthened auth validation:
  - username format checks
  - password length checks
  - name max length checks
- Added ID validation in request/chat/message routes
- Added message length guard for text payloads
- Added DB indexes for chat/message performance
- Added socket compatibility aliases:
  - `call-join`, `call-signal`, `call-leave`
  - `call-peer-joined`, `call-peer-left`, `call-room-joined`

### Frontend
- Added lazy-loaded route pages in `App.jsx`
- Added `React.memo` for heavy list components
- Improved file/photo UX:
  - image/file validation feedback
  - upload progress UI
  - image/audio rendering in message list
- Added voice message recording with `MediaRecorder` in composer
- Locked chat access no longer auto-expires after 60s
- Fixed login page mojibake icon/text encoding issues

## Notes
- Direct (1:1) chat messages are enforced as encrypted on backend.
- Group chat messages are plaintext server-side unless additional group-key E2EE is implemented.
- For production, configure TURN for reliable WebRTC across NAT/firewalls.
