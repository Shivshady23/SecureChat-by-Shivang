// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import crypto from "crypto";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import { authRequired } from "../middleware/auth.js";
import { getIO } from "../socket/index.js";

const router = express.Router();
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const MAX_REACTION_EMOJI_LENGTH = 16;
const MAX_EDIT_WINDOW_MS = 15 * 60 * 1000;

function computeIntegrityHash({
  ciphertextB64,
  ivB64,
  wrappedKeyB64,
  senderWrappedKeyB64,
  aadB64,
  clientTs,
  clientMsgId,
  senderId,
  receiverId
}) {
  const raw = [
    ciphertextB64 || "",
    ivB64 || "",
    wrappedKeyB64 || "",
    senderWrappedKeyB64 || "",
    aadB64 || "",
    String(clientTs || 0),
    clientMsgId || "",
    String(senderId || ""),
    String(receiverId || "")
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("base64");
}

function emitToChat(chatId, eventName, payload) {
  try {
    const io = getIO();
    io.to(String(chatId)).emit(eventName, payload);
  } catch (err) {
    console.error(`Socket emit failed (${eventName}):`, err.message || err);
  }
}

async function purgeDisappearedMessages(chat) {
  const candidates = await Message.find({
    chatId: chat._id,
    disappearsAfterReadAll: true
  }).select("_id readBy");

  const neededReads = chat.members.length;
  const messageIds = candidates
    .filter((m) => (m.readBy || []).length >= neededReads)
    .map((m) => String(m._id));

  if (messageIds.length === 0) return;

  if (chat.pinnedMessageId && messageIds.includes(String(chat.pinnedMessageId))) {
    chat.pinnedMessageId = null;
    await chat.save();
    emitToChat(chat._id, "chat:pin", {
      chatId: String(chat._id),
      pinnedMessage: null
    });
  }

  await Message.deleteMany({ _id: { $in: messageIds } });

  emitToChat(chat._id, "message:deleted", {
    chatId: String(chat._id),
    messageIds
  });
}

router.get("/:chatId", authRequired, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.members.some((m) => String(m) === req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }

  await purgeDisappearedMessages(chat);
  const messages = await Message.find({
    chatId: chat._id,
    deletedFor: { $ne: req.user.id }
  }).sort({ createdAt: 1 });

  const deliveryResult = await Message.updateMany(
    {
      chatId: chat._id,
      senderId: { $ne: req.user.id },
      deliveredTo: { $ne: req.user.id }
    },
    { $addToSet: { deliveredTo: req.user.id } }
  );

  if ((deliveryResult.modifiedCount || 0) > 0) {
    const deliveredMessages = messages
      .filter((m) => String(m.senderId) !== String(req.user.id))
      .filter((m) => !(m.deliveredTo || []).some((id) => String(id) === String(req.user.id)))
      .map((m) => String(m._id));

    if (deliveredMessages.length > 0) {
      emitToChat(chat._id, "message:delivered", {
        chatId: String(chat._id),
        messageIds: deliveredMessages,
        userId: req.user.id
      });
    }
  }

  return res.json({ messages });
});

router.post("/:chatId", authRequired, async (req, res) => {
  try {
    const {
      type,
      content,
      encrypted,
      iv,
      ivB64,
      fileKey,
      fileName,
      mimeType,
      size,
      replyTo,
      receiverId,
      ciphertextB64,
      wrappedKeyB64,
      senderWrappedKeyB64,
      aadB64,
      clientTs,
      clientMsgId,
      integrityHash
    } = req.body || {};

    const chat = await Chat.findById(req.params.chatId);
    if (!chat || !chat.members.some((m) => String(m) === req.user.id)) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (!type || !["text", "file"].includes(type)) {
      return res.status(400).json({ message: "Invalid type" });
    }
    if (chat.type === "direct" && !Boolean(encrypted)) {
      return res.status(400).json({ message: "Direct messages must be encrypted" });
    }

    const senderId = String(req.user.id);
    const directReceiverId =
      chat.type === "direct" ? String(chat.members.find((m) => String(m) !== senderId) || "") : "";

    const isEncryptedDirect = chat.type === "direct" && Boolean(encrypted);
    const requiresInlineCipher = type === "text";
    const ivValue = ivB64 || iv || "";
    const cipherValue = ciphertextB64 || (Boolean(encrypted) ? content || "" : "");

    if (isEncryptedDirect) {
      if (
        (!requiresInlineCipher && !fileKey) ||
        (requiresInlineCipher && !cipherValue) ||
        !wrappedKeyB64 ||
        !senderWrappedKeyB64 ||
        !aadB64 ||
        !clientTs ||
        !clientMsgId
      ) {
        return res.status(400).json({ message: "Missing encrypted payload fields" });
      }

      if (!directReceiverId) {
        return res.status(400).json({ message: "Direct receiver missing" });
      }

      if (receiverId && String(receiverId) !== directReceiverId) {
        return res.status(400).json({ message: "receiverId mismatch for direct chat" });
      }

      const ts = Number(clientTs);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
        return res.status(400).json({ message: "Invalid message timestamp" });
      }

      const expectedHash = computeIntegrityHash({
        ciphertextB64: requiresInlineCipher ? cipherValue : "",
        ivB64: ivValue,
        wrappedKeyB64,
        senderWrappedKeyB64,
        aadB64,
        clientTs: ts,
        clientMsgId,
        senderId,
        receiverId: directReceiverId
      });

      if (requiresInlineCipher && !integrityHash) {
        return res.status(400).json({ message: "Integrity hash is required" });
      }
      if (integrityHash && integrityHash !== expectedHash) {
        return res.status(400).json({ message: "Integrity validation failed" });
      }
    }

    let replyToId = null;
    if (replyTo) {
      const parent = await Message.findOne({ _id: replyTo, chatId: chat._id }).select("_id");
      if (!parent) {
        return res.status(400).json({ message: "Invalid reply target" });
      }
      replyToId = parent._id;
    }

    const message = await Message.create({
      chatId: chat._id,
      senderId: req.user.id,
      receiverId: directReceiverId || null,
      type,
      content: Boolean(encrypted) && type === "text" ? cipherValue : content || "",
      encrypted: Boolean(encrypted),
      iv: ivValue,
      ciphertextB64: type === "text" ? cipherValue || "" : "",
      wrappedKeyB64: wrappedKeyB64 || "",
      senderWrappedKeyB64: senderWrappedKeyB64 || "",
      aadB64: aadB64 || "",
      clientTs: Number(clientTs) || 0,
      clientMsgId: clientMsgId || "",
      integrityHash: integrityHash || "",
      fileKey: fileKey || "",
      fileName: fileName || "",
      mimeType: mimeType || "",
      size: size || 0,
      readBy: [req.user.id],
      deliveredTo: [req.user.id],
      disappearsAfterReadAll: Boolean(chat.vanishMode),
      replyTo: replyToId
    });

    chat.lastMessageAt = new Date();
    await chat.save();

    emitToChat(chat._id, "message:new", message);

    return res.json({ message });
  } catch (err) {
    if (err?.code === 11000 && err?.keyPattern?.clientMsgId) {
      return res.status(409).json({ message: "Replay detected: duplicate clientMsgId" });
    }
    console.error("Message create error:", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
});

router.post("/:chatId/read", authRequired, async (req, res) => {
  const { messageIds } = req.body;
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.json({ updated: 0 });
  }

  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.members.some((m) => String(m) === req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }

  const result = await Message.updateMany(
    { _id: { $in: messageIds }, readBy: { $ne: req.user.id } },
    { $addToSet: { readBy: req.user.id, deliveredTo: req.user.id } }
  );

  await purgeDisappearedMessages(chat);

  emitToChat(chat._id, "message:read", {
    chatId: String(chat._id),
    messageIds,
    userId: req.user.id
  });

  return res.json({ updated: result.modifiedCount || 0 });
});

router.patch("/:messageId", authRequired, async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) {
    return res.status(404).json({ message: "Message not found" });
  }

  if (message.type !== "text") {
    return res.status(400).json({ message: "Only text messages can be edited" });
  }

  if (String(message.senderId) !== String(req.user.id)) {
    return res.status(403).json({ message: "Only sender can edit this message" });
  }

  const createdAtMs = new Date(message.createdAt).getTime();
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > MAX_EDIT_WINDOW_MS) {
    return res.status(400).json({
      message: "Editing window expired. Messages can only be edited within 15 minutes of sending."
    });
  }

  const chat = await Chat.findById(message.chatId).select("_id members type");
  if (!chat || !chat.members.some((m) => String(m) === req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }

  const {
    content,
    encrypted,
    iv,
    ivB64,
    receiverId,
    ciphertextB64,
    wrappedKeyB64,
    senderWrappedKeyB64,
    aadB64,
    clientTs,
    clientMsgId,
    integrityHash
  } = req.body || {};

  if (chat.type === "direct") {
    if (!Boolean(encrypted)) {
      return res.status(400).json({ message: "Direct messages must stay encrypted" });
    }

    const senderId = String(req.user.id);
    const directReceiverId =
      chat.type === "direct" ? String(chat.members.find((m) => String(m) !== senderId) || "") : "";
    const ivValue = ivB64 || iv || "";
    const cipherValue = ciphertextB64 || content || "";

    if (
      !cipherValue ||
      !wrappedKeyB64 ||
      !senderWrappedKeyB64 ||
      !aadB64 ||
      !clientTs ||
      !clientMsgId
    ) {
      return res.status(400).json({ message: "Missing encrypted payload fields" });
    }

    if (!directReceiverId) {
      return res.status(400).json({ message: "Direct receiver missing" });
    }

    if (receiverId && String(receiverId) !== directReceiverId) {
      return res.status(400).json({ message: "receiverId mismatch for direct chat" });
    }

    const ts = Number(clientTs);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
      return res.status(400).json({ message: "Invalid message timestamp" });
    }

    const expectedHash = computeIntegrityHash({
      ciphertextB64: cipherValue,
      ivB64: ivValue,
      wrappedKeyB64,
      senderWrappedKeyB64,
      aadB64,
      clientTs: ts,
      clientMsgId,
      senderId,
      receiverId: directReceiverId
    });

    if (!integrityHash) {
      return res.status(400).json({ message: "Integrity hash is required" });
    }
    if (integrityHash !== expectedHash) {
      return res.status(400).json({ message: "Integrity validation failed" });
    }

    message.content = cipherValue;
    message.encrypted = true;
    message.iv = ivValue;
    message.ciphertextB64 = cipherValue;
    message.wrappedKeyB64 = wrappedKeyB64 || "";
    message.senderWrappedKeyB64 = senderWrappedKeyB64 || "";
    message.aadB64 = aadB64 || "";
    message.clientTs = ts;
    message.clientMsgId = clientMsgId || "";
    message.integrityHash = integrityHash || "";
  } else {
    const nextContent = String(content || "").trim();
    if (!nextContent) {
      return res.status(400).json({ message: "Message content is required" });
    }
    message.content = nextContent;
    message.encrypted = false;
    message.iv = "";
    message.ciphertextB64 = "";
    message.wrappedKeyB64 = "";
    message.senderWrappedKeyB64 = "";
    message.aadB64 = "";
    message.clientTs = 0;
    message.clientMsgId = "";
    message.integrityHash = "";
  }

  message.editedAt = new Date();
  await message.save();

  emitToChat(chat._id, "message:updated", {
    chatId: String(chat._id),
    message
  });

  return res.json({ message });
});

router.patch("/:messageId/reaction", authRequired, async (req, res) => {
  const emoji = String(req.body?.emoji || "").trim();
  if (!emoji || emoji.length > MAX_REACTION_EMOJI_LENGTH) {
    return res.status(400).json({ message: "Invalid emoji reaction" });
  }

  const message = await Message.findById(req.params.messageId);
  if (!message) {
    return res.status(404).json({ message: "Message not found" });
  }

  const chat = await Chat.findById(message.chatId).select("_id members");
  if (!chat || !chat.members.some((m) => String(m) === req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }

  const userId = String(req.user.id);
  const reactions = [];
  for (const entry of Array.isArray(message.reactions) ? message.reactions : []) {
    if (!entry) continue;
    const normalizedEmoji = String(entry.emoji || "").trim();
    if (!normalizedEmoji) continue;
    if (Array.isArray(entry.userIds)) {
      for (const legacyUserId of entry.userIds) {
        if (!legacyUserId) continue;
        reactions.push({ user: legacyUserId, emoji: normalizedEmoji });
      }
      continue;
    }
    if (entry.user) {
      reactions.push({ user: entry.user, emoji: normalizedEmoji });
    }
  }
  const existingIdx = reactions.findIndex((entry) => String(entry?.user) === userId);
  const existing = existingIdx >= 0 ? reactions[existingIdx] : null;

  if (existing && String(existing.emoji) === emoji) {
    reactions.splice(existingIdx, 1);
  } else if (existingIdx >= 0) {
    reactions[existingIdx] = { user: req.user.id, emoji };
  } else {
    reactions.push({ user: req.user.id, emoji });
  }

  message.reactions = reactions.map((entry) => ({
    user: entry.user,
    emoji: String(entry.emoji || "")
  }));
  await message.save();

  emitToChat(chat._id, "message:reaction", {
    chatId: String(chat._id),
    messageId: String(message._id),
    reactions: message.reactions || []
  });

  return res.json({ reactions: message.reactions || [] });
});

router.delete("/:messageId", authRequired, async (req, res) => {
  const scope = String(req.query.scope || "me").toLowerCase();
  if (!["me", "everyone"].includes(scope)) {
    return res.status(400).json({ message: "Invalid scope" });
  }

  const message = await Message.findById(req.params.messageId);
  if (!message) {
    return res.status(404).json({ message: "Message not found" });
  }

  const chat = await Chat.findById(message.chatId).select("_id members");
  if (!chat || !chat.members.some((m) => String(m) === req.user.id)) {
    return res.status(404).json({ message: "Chat not found" });
  }

  if (scope === "everyone") {
    if (String(message.senderId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Only sender can delete for everyone" });
    }

    if (chat.pinnedMessageId && String(chat.pinnedMessageId) === String(message._id)) {
      chat.pinnedMessageId = null;
      await chat.save();
      emitToChat(chat._id, "chat:pin", {
        chatId: String(chat._id),
        pinnedMessage: null
      });
    }

    await Message.deleteOne({ _id: message._id });
    emitToChat(chat._id, "message:deleted", {
      chatId: String(chat._id),
      messageIds: [String(message._id)]
    });

    return res.json({ success: true, scope: "everyone" });
  }

  await Message.updateOne(
    { _id: message._id },
    { $addToSet: { deletedFor: req.user.id } }
  );
  return res.json({ success: true, scope: "me" });
});

export default router;

