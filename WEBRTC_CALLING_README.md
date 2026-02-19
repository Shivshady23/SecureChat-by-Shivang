# WebRTC 1:1 Audio/Video Calling (Socket.io Signaling)

This repo now includes a standalone WebRTC demo:

- `server/` Node.js + Express + socket.io signaling server
- `client/` plain HTML/CSS/JS web client

It supports one room with a maximum of 2 participants.

## 1) Run the signaling server

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Default server URL: `http://localhost:4000`

## 2) Run the web client

```bash
cd client
npm install
npm start
```

Default client URL: `http://localhost:5500`

## 3) Test a call

1. Open `http://localhost:5500` in two browser windows.
2. Enter the same room ID in both tabs.
3. Click **Join** in both.
4. Use **Toggle Mic** and **Toggle Camera** to mute/unmute and disable/enable video.
5. Click **Leave** to exit.

## TURN configuration

Update `client/config.js`:

```js
window.APP_CONFIG = {
  SIGNALING_URL: "http://localhost:4000",
  TURN_URL: "",
  TURN_USERNAME: "",
  TURN_CREDENTIAL: ""
};
```

- STUN (`stun:stun.l.google.com:19302`) is already included.
- TURN is optional but recommended for restrictive NAT/firewall networks.

## Socket events

- `join-room` `{ roomId, userName? }`
- `signal` `{ roomId, to?, data }` where `data.type` is `offer | answer | ice`
- `leave-room` `{ roomId }`
- server emits `room-full`, `peer-joined`, `peer-left`, and relays `signal`.
