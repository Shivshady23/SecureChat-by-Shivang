// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import { authRequired } from "../middleware/auth.js";
import { verifyLockPassword } from "../middleware/verifyLockPassword.js";
import { getIO } from "../socket/index.js";

const router = express.Router();
const CHAT_MEMBER_SELECT = "_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl";
const MIN_LOCK_DIGEST_LENGTH = 32;

function normalizeGroupName(name) {
  return String(name || "").trim().slice(0, 80);
}

function normalizeGroupMotive(motive) {
  return String(motive || "").trim().slice(0, 160);
}

function validateAvatarUrl(rawAvatarUrl) {
  if (typeof rawAvatarUrl !== "string") {
    return { error: "avatarUrl must be a string" };
  }
  const normalized = rawAvatarUrl.trim();
  if (normalized && !normalized.startsWith("/uploads/")) {
    return { error: "avatarUrl must start with /uploads/" };
  }
  return { value: normalized };
}

function chatHasMember(chat, userId) {
  return (chat?.members || []).some((memberId) => String(memberId) === String(userId));
}

function isValidId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

async function populateChatById(chatId) {
  return Chat.findById(chatId)
    .populate("members", CHAT_MEMBER_SELECT)
    .populate("pinnedMessageId", "_id senderId type content fileName createdAt");
}

function stripSensitiveChatFields(chat) {
  const plain = chat?.toObject ? chat.toObject() : { ...(chat || {}) };
  if (plain && Object.prototype.hasOwnProperty.call(plain, "lockPasswordHash")) {
    delete plain.lockPasswordHash;
  }
  return plain;
}

async function enrichChatsWithUnread(chats, userObjectId) {
  const chatIds = chats.map((chat) => chat._id);
  const unreadRows =
    chatIds.length > 0
      ? await Message.aggregate([
          {
            $match: {
              chatId: { $in: chatIds },
              senderId: { $ne: userObjectId },
              readBy: { $ne: userObjectId },
              deletedFor: { $ne: userObjectId }
            }
          },
          {
            $group: {
              _id: "$chatId",
              count: { $sum: 1 }
            }
          }
        ])
      : [];

  const unreadMap = new Map(
    unreadRows.map((row) => [String(row._id), Math.max(0, Number(row.count) || 0)])
  );

  return chats.map((chat) => ({
    ...stripSensitiveChatFields(chat),
    unreadCount: unreadMap.get(String(chat._id)) || 0
  }));
}

async function findMemberChat(chatId, userId, includeLockHash = false) {
  const query = Chat.findOne({ _id: chatId, members: userId });
  if (includeLockHash) {
    query.select("+lockPasswordHash");
  }
  return query;
}

router.get("/", authRequired, async (req, res) => {
  const filter = String(req.query.filter || "all").trim().toLowerCase();
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const baseMatch = { members: req.user.id };

  if (filter === "locked") {
    baseMatch.isLocked = true;
  } else if (filter === "unlocked") {
    baseMatch.$or = [{ isLocked: { $exists: false } }, { isLocked: false }];
  }

  const chatQuery = Chat.find(baseMatch)
    .populate("members", CHAT_MEMBER_SELECT)
    .populate("pinnedMessageId", "_id senderId type content fileName createdAt")
    .sort({ lastMessageAt: -1, updatedAt: -1 });
  if (filter === "locked") {
    chatQuery.select("+lockPasswordHash");
  }
  const chats = await chatQuery;

  if (filter === "locked") {
    const passwordDigest = String(req.query.passwordDigest || "").trim();
    if (!passwordDigest) {
      return res.status(400).json({ message: "passwordDigest is required for locked chats" });
    }

    const verified = [];
    for (const chat of chats) {
      const hash = String(chat.lockPasswordHash || "").trim();
      if (!hash) continue;
      const ok = await bcrypt.compare(passwordDigest, hash);
      if (ok) verified.push(chat);
    }

    const withUnread = await enrichChatsWithUnread(verified, userObjectId);
    return res.json({ chats: withUnread });
  }

  const withUnread = await enrichChatsWithUnread(chats, userObjectId);

  return res.json({ chats: withUnread });
});

router.post("/group", authRequired, async (req, res) => {
  const { name, memberIds, motive = "", avatarUrl = "" } = req.body || {};
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName || !Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ message: "Group name and members required" });
  }

  const cleanMemberIds = memberIds
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim());
  if (cleanMemberIds.length === 0) {
    return res.status(400).json({ message: "At least one valid member is required" });
  }

  if (typeof motive !== "string") {
    return res.status(400).json({ message: "motive must be a string" });
  }

  const avatarValidation = validateAvatarUrl(String(avatarUrl || ""));
  if (avatarValidation.error) {
    return res.status(400).json({ message: avatarValidation.error });
  }

  const unique = Array.from(new Set([req.user.id, ...cleanMemberIds]));
  const chat = await Chat.create({
    type: "group",
    name: normalizedName,
    motive: normalizeGroupMotive(motive),
    avatarUrl: avatarValidation.value || "",
    members: unique,
    createdBy: req.user.id
  });

  const populated = await populateChatById(chat._id);
  return res.json({ chat: populated });
});

router.patch("/:chatId/group-profile", authRequired, async (req, res) => {
  if (!isValidId(req.params.chatId)) {
    return res.status(400).json({ message: "Invalid chat id" });
  }
  const { name, motive, avatarUrl } = req.body || {};

  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chatHasMember(chat, req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }
  if (chat.type !== "group") {
    return res.status(400).json({ message: "Only group chats can be updated" });
  }
  if (String(chat.createdBy) !== String(req.user.id)) {
    return res.status(403).json({ message: "Only group admin can edit group profile" });
  }

  let hasChanges = false;

  if (name !== undefined) {
    if (typeof name !== "string") {
      return res.status(400).json({ message: "name must be a string" });
    }
    const normalized = normalizeGroupName(name);
    if (!normalized) {
      return res.status(400).json({ message: "Group name cannot be empty" });
    }
    chat.name = normalized;
    hasChanges = true;
  }

  if (motive !== undefined) {
    if (typeof motive !== "string") {
      return res.status(400).json({ message: "motive must be a string" });
    }
    chat.motive = normalizeGroupMotive(motive);
    hasChanges = true;
  }

  if (avatarUrl !== undefined) {
    const avatarValidation = validateAvatarUrl(avatarUrl);
    if (avatarValidation.error) {
      return res.status(400).json({ message: avatarValidation.error });
    }
    chat.avatarUrl = avatarValidation.value || "";
    hasChanges = true;
  }

  if (!hasChanges) {
    return res.status(400).json({ message: "No updates provided" });
  }

  await chat.save();
  const populated = await populateChatById(chat._id);
  const payloadChat = populated?.toObject ? populated.toObject() : populated;

  try {
    const io = getIO();
    io.to(String(chat._id)).emit("chat:updated", { chat: payloadChat });
  } catch (err) {
    console.error("Socket emit failed (chat:updated):", err.message || err);
  }

  return res.json({ chat: payloadChat });
});

router.delete("/:chatId/members/:memberId", authRequired, async (req, res) => {
  const { chatId, memberId } = req.params;
  if (!isValidId(chatId) || !isValidId(memberId)) {
    return res.status(400).json({ message: "Invalid chat or member id" });
  }

  const chat = await Chat.findById(chatId);
  if (!chat || !chatHasMember(chat, req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }
  if (chat.type !== "group") {
    return res.status(400).json({ message: "Only group chats support member removal" });
  }
  if (String(chat.createdBy) !== String(req.user.id)) {
    return res.status(403).json({ message: "Only group admin can remove members" });
  }
  if (String(memberId) === String(req.user.id)) {
    return res.status(400).json({ message: "Group admin cannot remove self" });
  }
  if (!chatHasMember(chat, memberId)) {
    return res.status(404).json({ message: "Member not found in this group" });
  }

  chat.members = chat.members.filter((id) => String(id) !== String(memberId));

  if (String(chat.createdBy) === String(memberId) && chat.members.length > 0) {
    chat.createdBy = chat.members[0];
  }

  await chat.save();

  const populated = await populateChatById(chat._id);
  const payloadChat = populated?.toObject ? populated.toObject() : populated;

  try {
    const io = getIO();

    io.to(String(chat._id)).emit("chat:member-removed", {
      chatId: String(chat._id),
      memberId: String(memberId),
      removedBy: req.user.id
    });
    io.to(String(chat._id)).emit("chat:updated", { chat: payloadChat });

    const socketsInRoom = await io.in(String(chat._id)).fetchSockets();
    for (const socket of socketsInRoom) {
      if (String(socket.userId) === String(memberId)) {
        socket.emit("chat:removed", { chatId: String(chat._id) });
        socket.leave(String(chat._id));
      }
    }
  } catch (err) {
    console.error("Socket emit failed (chat:member-removed/chat:updated):", err.message || err);
  }

  return res.json({ chat: payloadChat, removedMemberId: String(memberId) });
});

router.patch("/:chatId/vanish", authRequired, async (req, res) => {
  if (!isValidId(req.params.chatId)) {
    return res.status(400).json({ message: "Invalid chat id" });
  }
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled must be boolean" });
  }

  const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user.id });
  if (!chat) {
    return res.status(404).json({ message: "Chat not found" });
  }

  chat.vanishMode = enabled;
  await chat.save();

  try {
    const io = getIO();
    io.to(String(chat._id)).emit("chat:vanish", {
      chatId: String(chat._id),
      enabled,
      changedBy: req.user.id
    });
  } catch (err) {
    console.error("Socket emit failed (chat:vanish):", err.message || err);
  }

  return res.json({ chat: { _id: chat._id, vanishMode: chat.vanishMode } });
});

router.patch("/:chatId/pin", authRequired, async (req, res) => {
  if (!isValidId(req.params.chatId)) {
    return res.status(400).json({ message: "Invalid chat id" });
  }
  const { messageId } = req.body || {};
  const chat = await Chat.findOne({ _id: req.params.chatId, members: req.user.id });
  if (!chat) {
    return res.status(404).json({ message: "Chat not found" });
  }

  if (!messageId) {
    chat.pinnedMessageId = null;
    await chat.save();
    try {
      const io = getIO();
      io.to(String(chat._id)).emit("chat:pin", {
        chatId: String(chat._id),
        pinnedMessage: null
      });
    } catch (err) {
      console.error("Socket emit failed (chat:pin):", err.message || err);
    }
    return res.json({ chat: { _id: chat._id, pinnedMessageId: null } });
  }

  const message = await Message.findOne({ _id: messageId, chatId: chat._id })
    .select("_id senderId type content fileName createdAt");
  if (!message) {
    return res.status(404).json({ message: "Message not found in chat" });
  }

  chat.pinnedMessageId = message._id;
  await chat.save();

  try {
    const io = getIO();
    io.to(String(chat._id)).emit("chat:pin", {
      chatId: String(chat._id),
      pinnedMessage: message
    });
  } catch (err) {
    console.error("Socket emit failed (chat:pin):", err.message || err);
  }

  return res.json({
    chat: {
      _id: chat._id,
      pinnedMessageId: message
    }
  });
});

router.post("/:chatId/lock", authRequired, async (req, res) => {
  if (!isValidId(req.params.chatId)) {
    return res.status(400).json({ message: "Invalid chat id" });
  }
  const chat = await findMemberChat(req.params.chatId, req.user.id);
  if (!chat) {
    return res.status(404).json({ message: "Chat not found" });
  }
  const passwordDigest = String(req.body?.passwordDigest || "").trim();
  if (!passwordDigest) {
    return res.status(400).json({ message: "passwordDigest is required" });
  }
  if (passwordDigest.length < MIN_LOCK_DIGEST_LENGTH) {
    return res.status(400).json({ message: "Invalid password digest" });
  }

  const hash = await bcrypt.hash(passwordDigest, 12);
  chat.isLocked = true;
  chat.lockPasswordHash = hash;
  await chat.save();

  try {
    const io = getIO();
    io.to(String(chat._id)).emit("chat:lock-state", {
      chatId: String(chat._id),
      isLocked: true,
      changedBy: req.user.id
    });
  } catch (err) {
    console.error("Socket emit failed (chat:lock-state):", err.message || err);
  }

  return res.json({ chat: { _id: chat._id, isLocked: true } });
});

router.post("/:chatId/unlock", authRequired, async (req, res, next) => {
  if (!isValidId(req.params.chatId)) {
    return res.status(400).json({ message: "Invalid chat id" });
  }
  const chat = await findMemberChat(req.params.chatId, req.user.id, true);
  if (!chat) {
    return res.status(404).json({ message: "Chat not found" });
  }
  req.chat = chat;
  return next();
}, verifyLockPassword, async (req, res) => {
  const chat = req.chat;
  chat.isLocked = false;
  chat.lockPasswordHash = "";
  await chat.save();

  try {
    const io = getIO();
    io.to(String(chat._id)).emit("chat:lock-state", {
      chatId: String(chat._id),
      isLocked: false,
      changedBy: req.user.id
    });
  } catch (err) {
    console.error("Socket emit failed (chat:lock-state):", err.message || err);
  }

  return res.json({ chat: { _id: chat._id, isLocked: false } });
});

export default router;

