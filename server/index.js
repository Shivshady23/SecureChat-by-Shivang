import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 4000);
const allowedOrigins = String(process.env.CLIENT_ORIGIN || "http://localhost:5500")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true
  })
);
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

const socketRoomMap = new Map();

function getRoomMembers(roomId) {
  const members = io.sockets.adapter.rooms.get(roomId);
  return members ? Array.from(members) : [];
}

function log(message, extra = {}) {
  console.log(`[signal] ${message}`, extra);
}

function leaveTrackedRoom(socket, reason = "leave") {
  const currentRoomId = socketRoomMap.get(socket.id);
  if (!currentRoomId) return;

  io.to(currentRoomId).except(socket.id).emit("peer-left", {
    roomId: currentRoomId,
    socketId: socket.id,
    reason
  });

  socket.leave(currentRoomId);
  socketRoomMap.delete(socket.id);

  log("peer-left", { roomId: currentRoomId, socketId: socket.id, reason });
}

io.on("connection", (socket) => {
  log("connected", { socketId: socket.id });

  socket.on("join-room", (payload = {}, ack) => {
    const roomId = String(payload.roomId || "").trim();
    const userName = String(payload.userName || "").trim();

    if (!roomId) {
      const error = { ok: false, error: "roomId is required" };
      if (typeof ack === "function") ack(error);
      return;
    }

    const currentRoomId = socketRoomMap.get(socket.id);
    if (currentRoomId && currentRoomId !== roomId) {
      leaveTrackedRoom(socket, "switch-room");
    }

    if (currentRoomId === roomId) {
      const members = getRoomMembers(roomId);
      const response = {
        ok: true,
        roomId,
        socketId: socket.id,
        isInitiator: members.length <= 1,
        peers: members.filter((memberId) => memberId !== socket.id)
      };
      if (typeof ack === "function") ack(response);
      return;
    }

    const membersBeforeJoin = getRoomMembers(roomId);
    if (membersBeforeJoin.length >= 2) {
      socket.emit("room-full", { roomId });
      if (typeof ack === "function") ack({ ok: false, error: "room-full", roomId });
      log("room-full", { roomId, socketId: socket.id });
      return;
    }

    const isInitiator = membersBeforeJoin.length === 0;
    socket.join(roomId);
    socketRoomMap.set(socket.id, roomId);

    socket.to(roomId).emit("peer-joined", {
      roomId,
      socketId: socket.id,
      userName
    });

    const membersAfterJoin = getRoomMembers(roomId);
    socket.emit("room-joined", {
      roomId,
      socketId: socket.id,
      isInitiator,
      peers: membersAfterJoin.filter((memberId) => memberId !== socket.id)
    });

    if (typeof ack === "function") {
      ack({
        ok: true,
        roomId,
        socketId: socket.id,
        isInitiator,
        peers: membersAfterJoin.filter((memberId) => memberId !== socket.id)
      });
    }

    log("join-room", { roomId, socketId: socket.id, isInitiator });
  });

  socket.on("signal", (payload = {}) => {
    const roomId = String(payload.roomId || socketRoomMap.get(socket.id) || "").trim();
    const to = payload.to ? String(payload.to).trim() : "";
    const data = payload.data || {};

    if (!roomId || typeof data !== "object" || !data.type) {
      return;
    }

    const outgoing = {
      roomId,
      from: socket.id,
      to: to || undefined,
      data
    };

    if (to) {
      const members = new Set(getRoomMembers(roomId));
      if (!members.has(to)) {
        log("signal-target-missing", { roomId, from: socket.id, to, type: data.type });
        return;
      }
      io.to(to).emit("signal", outgoing);
      log("signal-direct", { roomId, from: socket.id, to, type: data.type });
      return;
    }

    socket.to(roomId).emit("signal", outgoing);
    log("signal-broadcast", { roomId, from: socket.id, type: data.type });
  });

  socket.on("leave-room", (payload = {}) => {
    const requestedRoomId = String(payload.roomId || "").trim();
    const currentRoomId = socketRoomMap.get(socket.id);
    if (!currentRoomId) return;
    if (requestedRoomId && requestedRoomId !== currentRoomId) return;
    leaveTrackedRoom(socket, "leave-room");
  });

  socket.on("disconnect", (reason) => {
    leaveTrackedRoom(socket, `disconnect:${reason}`);
    log("disconnected", { socketId: socket.id, reason });
  });
});

server.listen(PORT, () => {
  log("server-started", { port: PORT, allowedOrigins });
});
