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
const activeCalls = new Map();

function randomCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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

function isUserBusy(userId) {
  const normalized = String(userId);
  for (const call of activeCalls.values()) {
    if (call.status === "ended") continue;
    if (String(call.callerId) === normalized || String(call.calleeId) === normalized) {
      return true;
    }
  }
  return false;
}

function endCallSession(callId) {
  const key = String(callId || "");
  if (!key) return null;
  const call = activeCalls.get(key);
  if (!call) return null;
  call.status = "ended";
  activeCalls.delete(key);
  return call;
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
    } catch (err) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    addOnlineSocket(userId, socket.id);

    const chats = await Chat.find({ members: userId }).select("_id");
    chats.forEach((chat) => socket.join(String(chat._id)));

    io.emit("presence", { online: Array.from(onlineUsers.keys()) });

    socket.on("call-user", async (payload = {}) => {
      try {
        const callerId = String(userId);
        const calleeId = String(payload.toUserId || "");
        const chatId = String(payload.chatId || "");
        const callType = payload.callType === "video" ? "video" : "voice";
        const offer = payload.offer || null;
        const timeoutMs = Math.max(5000, Math.min(120000, Number(payload.timeoutMs || 30000)));

        if (!calleeId || !chatId || !offer) {
          socket.emit("call-error", { message: "Invalid call payload" });
          return;
        }
        if (calleeId === callerId) {
          socket.emit("call-error", { message: "Cannot call yourself" });
          return;
        }

        const isAllowed = await ensureDirectChatMemberPair(chatId, callerId, calleeId);
        if (!isAllowed) {
          socket.emit("call-error", { message: "Unauthorized call target" });
          return;
        }

        if (isUserBusy(callerId)) {
          socket.emit("busy", { userId: callerId, reason: "caller-in-call" });
          return;
        }
        if (isUserBusy(calleeId)) {
          socket.emit("busy", { userId: calleeId, reason: "callee-in-call" });
          return;
        }

        const calleeSocketId = getPrimarySocketId(calleeId);
        if (!calleeSocketId) {
          socket.emit("call-rejected", { reason: "offline", callId: "" });
          return;
        }

        const requestedCallId = String(payload.callId || "").trim();
        const callId =
          requestedCallId && !activeCalls.has(requestedCallId)
            ? requestedCallId
            : randomCallId();
        const callSession = {
          callId,
          chatId,
          callerId,
          calleeId,
          callType,
          status: "calling",
          startedAt: Date.now(),
          timeoutMs
        };
        activeCalls.set(callId, callSession);

        io.to(calleeSocketId).emit("incoming-call", {
          callId,
          chatId,
          fromUserId: callerId,
          fromSocketId: socket.id,
          toSocketId: calleeSocketId,
          callType,
          offer,
          timeoutMs
        });

        socket.emit("calling", {
          callId,
          toUserId: calleeId,
          toSocketId: calleeSocketId,
          callType,
          timeoutMs
        });
      } catch (err) {
        socket.emit("call-error", { message: err?.message || "Failed to initiate call" });
      }
    });

    socket.on("answer-call", async (payload = {}) => {
      try {
        const callId = String(payload.callId || "");
        const answer = payload.answer || null;
        const call = activeCalls.get(callId);
        if (!call) {
          socket.emit("call-error", { message: "Call not found" });
          return;
        }
        if (String(call.calleeId) !== String(userId)) {
          socket.emit("call-error", { message: "Unauthorized call answer" });
          return;
        }
        if (!answer) {
          socket.emit("call-error", { message: "Missing WebRTC answer" });
          return;
        }
        call.status = "accepted";
        call.acceptedAt = Date.now();

        emitToUser(call.callerId, "answer-call", {
          callId,
          fromUserId: String(userId),
          fromSocketId: socket.id,
          answer
        });
        emitToUser(call.calleeId, "call-accepted", {
          callId,
          byUserId: String(userId)
        });
      } catch (err) {
        socket.emit("call-error", { message: err?.message || "Failed to answer call" });
      }
    });

    socket.on("ice-candidate", (payload = {}) => {
      const callId = String(payload.callId || "");
      const toUserId = String(payload.toUserId || "");
      const toSocketId = String(payload.toSocketId || "");
      const candidate = payload.candidate || null;
      const call = activeCalls.get(callId);
      if (!call || !candidate) return;

      const me = String(userId);
      const allowed =
        (String(call.callerId) === me && String(call.calleeId) === toUserId) ||
        (String(call.calleeId) === me && String(call.callerId) === toUserId);
      if (!allowed) return;

      const payloadBase = {
        callId,
        fromUserId: me,
        fromSocketId: socket.id,
        candidate
      };

      if (toSocketId) {
        io.to(toSocketId).emit("ice-candidate", payloadBase);
        return;
      }
      emitToUser(toUserId, "ice-candidate", payloadBase);
    });

    socket.on("call-rejected", (payload = {}) => {
      const callId = String(payload.callId || "");
      const reason = String(payload.reason || "rejected");
      const call = activeCalls.get(callId);
      if (!call) return;
      if (String(call.calleeId) !== String(userId)) return;
      endCallSession(callId);
      emitToUser(call.callerId, "call-rejected", {
        callId,
        byUserId: String(userId),
        reason
      });
    });

    socket.on("end-call", (payload = {}) => {
      const callId = String(payload.callId || "");
      const reason = String(payload.reason || "ended");
      const call = activeCalls.get(callId);
      if (!call) return;
      const me = String(userId);
      const isParticipant = String(call.callerId) === me || String(call.calleeId) === me;
      if (!isParticipant) return;
      endCallSession(callId);
      const targetUserId = String(call.callerId) === me ? String(call.calleeId) : String(call.callerId);
      emitToUser(targetUserId, "end-call", {
        callId,
        byUserId: me,
        reason
      });
      socket.emit("end-call", { callId, byUserId: me, reason });
    });

    socket.on("typing", ({ chatId, isTyping }) => {
      socket.to(chatId).emit("typing", { chatId, userId, isTyping: Boolean(isTyping) });
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
      removeOnlineSocket(userId, socket.id);
      const myUserId = String(userId);
      for (const [callId, call] of activeCalls.entries()) {
        const isParticipant =
          String(call.callerId) === myUserId || String(call.calleeId) === myUserId;
        if (!isParticipant) continue;
        endCallSession(callId);
        const peerId = String(call.callerId) === myUserId ? String(call.calleeId) : String(call.callerId);
        emitToUser(peerId, "end-call", {
          callId,
          byUserId: myUserId,
          reason: "disconnect"
        });
      }
      io.emit("presence", { online: Array.from(onlineUsers.keys()) });
    });
  });

  ioInstance = io;
}

