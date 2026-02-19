// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";

let ioInstance = null;
const onlineUsers = new Map();
const socketCallRoomMap = new Map();

function getUserSocketSet(userId) {
  const key = String(userId);
  if (!onlineUsers.has(key)) {
    onlineUsers.set(key, new Set());
  }
  return onlineUsers.get(key);
}

function addOnlineSocket(userId, socketId) {
  const sockets = getUserSocketSet(userId);
  sockets.add(String(socketId));
}

function removeOnlineSocket(userId, socketId) {
  const key = String(userId);
  const sockets = onlineUsers.get(key);
  if (!sockets) return;
  sockets.delete(String(socketId));
  if (sockets.size === 0) {
    onlineUsers.delete(key);
  }
}

function getPrimarySocketId(userId) {
  const sockets = onlineUsers.get(String(userId));
  if (!sockets || sockets.size === 0) return "";
  return Array.from(sockets)[0] || "";
}

function emitToUser(userId, event, payload) {
  const sockets = onlineUsers.get(String(userId));
  if (!sockets || sockets.size === 0) return false;
  sockets.forEach((socketId) => {
    ioInstance.to(socketId).emit(event, payload);
  });
  return true;
}

function getCallRoomMembers(roomId) {
  if (!ioInstance || !roomId) return [];
  const members = ioInstance.sockets.adapter.rooms.get(String(roomId));
  return members ? Array.from(members) : [];
}

function leaveActiveCallRoom(socket, { reason = "leave-room", expectedRoomId = "" } = {}) {
  const currentRoomId = String(socketCallRoomMap.get(socket.id) || "");
  if (!currentRoomId) return "";
  if (expectedRoomId && String(expectedRoomId) !== currentRoomId) return "";

  socket.leave(currentRoomId);
  socketCallRoomMap.delete(socket.id);

  socket.to(currentRoomId).emit("peer-left", {
    roomId: currentRoomId,
    socketId: socket.id,
    userId: String(socket.userId || ""),
    reason
  });
  socket.to(currentRoomId).emit("call-peer-left", {
    roomId: currentRoomId,
    socketId: socket.id,
    userId: String(socket.userId || ""),
    reason
  });

  return currentRoomId;
}

function isUserInCall(userId) {
  const sockets = onlineUsers.get(String(userId));
  if (!sockets || sockets.size === 0) return false;
  for (const socketId of sockets.values()) {
    if (socketCallRoomMap.has(String(socketId))) {
      return true;
    }
  }
  return false;
}

async function ensureDirectChatMemberPair(chatId, callerId, calleeId) {
  if (!chatId || !callerId || !calleeId) return false;
  const chat = await Chat.findOne({
    _id: chatId,
    type: "direct",
    members: { $all: [callerId, calleeId] }
  }).select("_id members type");
  return Boolean(chat);
}

export function getIO() {
  if (!ioInstance) {
    throw new Error("Socket.io not initialized");
  }
  return ioInstance;
}

export function initSocket(server, { origin }) {
  const io = new Server(server, {
    cors: { origin, credentials: true }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || "";
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    addOnlineSocket(userId, socket.id);

    try {
      const chats = await Chat.find({ members: userId }).select("_id");
      chats.forEach((chat) => socket.join(String(chat._id)));
    } catch (err) {
      console.error("Socket bootstrap failed to join chat rooms:", err?.message || err);
    }

    io.emit("presence", { online: Array.from(onlineUsers.keys()) });

    const handleJoinRoom = (payload = {}, ack) => {
      const roomId = String(payload.roomId || "").trim();
      const userName = String(payload.userName || "").trim();

      if (!roomId) {
        const error = { ok: false, error: "roomId is required" };
        if (typeof ack === "function") ack(error);
        socket.emit("call-error", { message: "roomId is required" });
        return;
      }

      const activeRoomId = String(socketCallRoomMap.get(socket.id) || "");
      if (activeRoomId && activeRoomId !== roomId) {
        leaveActiveCallRoom(socket, { reason: "switch-room" });
      }

      if (activeRoomId === roomId) {
        const peers = getCallRoomMembers(roomId).filter((id) => id !== socket.id);
        const response = {
          ok: true,
          roomId,
          socketId: socket.id,
          isInitiator: peers.length === 0,
          peers
        };
        if (typeof ack === "function") ack(response);
        return;
      }

      const membersBeforeJoin = getCallRoomMembers(roomId);
      if (membersBeforeJoin.length >= 2) {
        socket.emit("room-full", { roomId });
        if (typeof ack === "function") {
          ack({ ok: false, error: "room-full", roomId });
        }
        return;
      }

      socket.join(roomId);
      socketCallRoomMap.set(socket.id, roomId);

      const membersAfterJoin = getCallRoomMembers(roomId);
      const peers = membersAfterJoin.filter((id) => id !== socket.id);
      const isInitiator = membersAfterJoin.length === 1;

      socket.to(roomId).emit("peer-joined", {
        roomId,
        socketId: socket.id,
        userId: String(userId),
        userName
      });
      socket.to(roomId).emit("call-peer-joined", {
        roomId,
        socketId: socket.id,
        userId: String(userId),
        userName
      });

      socket.emit("room-joined", {
        roomId,
        socketId: socket.id,
        isInitiator,
        peers
      });
      socket.emit("call-room-joined", {
        roomId,
        socketId: socket.id,
        isInitiator,
        peers
      });

      if (typeof ack === "function") {
        ack({
          ok: true,
          roomId,
          socketId: socket.id,
          isInitiator,
          peers
        });
      }
    };

    const handleSignal = (payload = {}) => {
      const roomId = String(payload.roomId || socketCallRoomMap.get(socket.id) || "").trim();
      const to = String(payload.to || "").trim();
      const data = payload.data || {};
      const dataType = String(data.type || "").trim();

      if (!roomId || !["offer", "answer", "ice"].includes(dataType)) return;
      if (String(socketCallRoomMap.get(socket.id) || "") !== roomId) return;

      const outgoing = {
        roomId,
        from: socket.id,
        fromUserId: String(userId),
        to: to || undefined,
        data
      };

      if (to) {
        const roomMembers = getCallRoomMembers(roomId);
        if (!roomMembers.includes(to)) {
          socket.emit("call-error", { message: "Signal target is not in this room." });
          return;
        }
        io.to(to).emit("signal", outgoing);
        io.to(to).emit("call-signal", outgoing);
        return;
      }

      socket.to(roomId).emit("signal", outgoing);
      socket.to(roomId).emit("call-signal", outgoing);
    };

    const handleLeaveRoom = (payload = {}, ack) => {
      const roomId = String(payload.roomId || "").trim();
      const leftRoomId = leaveActiveCallRoom(socket, {
        reason: "leave-room",
        expectedRoomId: roomId || ""
      });
      if (typeof ack === "function") {
        ack({
          ok: Boolean(leftRoomId),
          roomId: leftRoomId || roomId
        });
      }
    };

    socket.on("join-room", handleJoinRoom);
    socket.on("call-join", handleJoinRoom);
    socket.on("signal", handleSignal);
    socket.on("call-signal", handleSignal);
    socket.on("leave-room", handleLeaveRoom);
    socket.on("call-leave", handleLeaveRoom);

    socket.on("call-invite", async (payload = {}) => {
      try {
        const callerId = String(userId);
        const calleeId = String(payload.toUserId || "").trim();
        const chatId = String(payload.chatId || "").trim();
        const roomId = String(payload.roomId || "").trim();
        const callType = payload.callType === "video" ? "video" : "voice";

        if (!calleeId || !chatId || !roomId) {
          socket.emit("call-error", { message: "Invalid call invite payload." });
          return;
        }
        if (calleeId === callerId) {
          socket.emit("call-error", { message: "Cannot call yourself." });
          return;
        }

        const allowed = await ensureDirectChatMemberPair(chatId, callerId, calleeId);
        if (!allowed) {
          socket.emit("call-error", { message: "Unauthorized call target." });
          return;
        }

        if (isUserInCall(calleeId)) {
          socket.emit("busy", { userId: calleeId, reason: "callee-in-call", roomId });
          return;
        }

        const calleeSocketId = getPrimarySocketId(calleeId);
        if (!calleeSocketId) {
          socket.emit("call-rejected", {
            roomId,
            byUserId: calleeId,
            reason: "offline"
          });
          return;
        }

        emitToUser(calleeId, "incoming-call", {
          roomId,
          chatId,
          fromUserId: callerId,
          fromSocketId: socket.id,
          callType,
          startedAt: Date.now()
        });

        socket.emit("calling", {
          roomId,
          chatId,
          toUserId: calleeId,
          toSocketId: calleeSocketId,
          callType
        });
      } catch (err) {
        socket.emit("call-error", { message: err?.message || "Failed to invite user for call." });
      }
    });

    socket.on("call-accepted", (payload = {}) => {
      const roomId = String(payload.roomId || "").trim();
      const toUserId = String(payload.toUserId || "").trim();
      if (!roomId || !toUserId) return;
      emitToUser(toUserId, "call-accepted", {
        roomId,
        byUserId: String(userId),
        bySocketId: socket.id
      });
    });

    socket.on("call-rejected", (payload = {}) => {
      const roomId = String(payload.roomId || "").trim();
      const toUserId = String(payload.toUserId || "").trim();
      const reason = String(payload.reason || "rejected");
      if (!roomId || !toUserId) return;
      emitToUser(toUserId, "call-rejected", {
        roomId,
        byUserId: String(userId),
        reason
      });
    });

    socket.on("end-call", (payload = {}) => {
      const roomId = String(payload.roomId || "").trim();
      const toUserId = String(payload.toUserId || "").trim();
      const reason = String(payload.reason || "ended");

      leaveActiveCallRoom(socket, {
        reason: `end-call:${reason}`,
        expectedRoomId: roomId || ""
      });

      if (toUserId) {
        emitToUser(toUserId, "end-call", {
          roomId,
          byUserId: String(userId),
          reason
        });
      }

      socket.emit("end-call", {
        roomId,
        byUserId: String(userId),
        reason
      });
    });

    socket.on("typing", ({ chatId, isTyping }) => {
      socket.to(chatId).emit("typing", { chatId, userId, isTyping: Boolean(isTyping) });
    });

    socket.on("chat-message", async (payload = {}) => {
      const roomId = String(payload.roomId || "").trim();
      const message = payload.message || null;
      if (!roomId || !message) return;

      const isMember = await Chat.exists({ _id: roomId, members: userId });
      if (!isMember) return;

      socket.to(roomId).emit("chat-message", {
        roomId,
        fromUserId: String(userId),
        message
      });
    });

    socket.on("message:read", async ({ chatId, messageIds }) => {
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;
      await Message.updateMany(
        { _id: { $in: messageIds }, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId, deliveredTo: userId } }
      );
      io.to(chatId).emit("message:read", { chatId, messageIds, userId });

      const chat = await Chat.findById(chatId).select("_id members pinnedMessageId");
      if (!chat) return;

      const candidates = await Message.find({
        chatId: chat._id,
        disappearsAfterReadAll: true
      }).select("_id readBy");
      const neededReads = chat.members.length;
      const removeIds = candidates
        .filter((m) => (m.readBy || []).length >= neededReads)
        .map((m) => String(m._id));

      if (removeIds.length > 0) {
        if (chat.pinnedMessageId && removeIds.includes(String(chat.pinnedMessageId))) {
          chat.pinnedMessageId = null;
          await chat.save();
          io.to(String(chat._id)).emit("chat:pin", {
            chatId: String(chat._id),
            pinnedMessage: null
          });
        }
        await Message.deleteMany({ _id: { $in: removeIds } });
        io.to(String(chat._id)).emit("message:deleted", {
          chatId: String(chat._id),
          messageIds: removeIds
        });
      }
    });

    socket.on("disconnect", () => {
      leaveActiveCallRoom(socket, { reason: "disconnect" });
      removeOnlineSocket(userId, socket.id);
      io.emit("presence", { online: Array.from(onlineUsers.keys()) });
    });
  });

  ioInstance = io;
}
