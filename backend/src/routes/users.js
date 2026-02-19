// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import User from "../models/User.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import ChatRequest from "../models/ChatRequest.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/me", authRequired, async (req, res) => {
  const user = await User.findById(req.user.id).select("_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");
  return res.json({ user });
});

router.get("/", authRequired, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } }).select("_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");
  return res.json({ users });
});

router.patch("/me/key", authRequired, async (req, res) => {
  const { publicKeyJwk } = req.body || {};
  if (!publicKeyJwk || typeof publicKeyJwk !== "object") {
    return res.status(400).json({ message: "publicKeyJwk is required" });
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { publicKeyJwk },
    { new: true }
  ).select("_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({ user });
});

router.patch("/me/e2ee-key", authRequired, async (req, res) => {
  const { e2eePublicKeySpkiB64 } = req.body || {};
  if (!e2eePublicKeySpkiB64 || typeof e2eePublicKeySpkiB64 !== "string") {
    return res.status(400).json({ message: "e2eePublicKeySpkiB64 is required" });
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { e2eePublicKeySpkiB64: e2eePublicKeySpkiB64.trim() },
    { new: true }
  ).select("_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({ user });
});

router.patch("/me/about", authRequired, async (req, res) => {
  const { about } = req.body || {};
  if (typeof about !== "string") {
    return res.status(400).json({ message: "about must be a string" });
  }

  const normalizedAbout = about.trim().slice(0, 120);
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { about: normalizedAbout },
    { new: true }
  ).select("_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({ user });
});

router.patch("/me/avatar", authRequired, async (req, res) => {
  const { avatarUrl } = req.body || {};
  if (typeof avatarUrl !== "string") {
    return res.status(400).json({ message: "avatarUrl must be a string" });
  }

  const normalized = avatarUrl.trim();
  if (normalized && !normalized.startsWith("/uploads/")) {
    return res.status(400).json({ message: "avatarUrl must start with /uploads/" });
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { avatarUrl: normalized },
    { new: true }
  ).select("_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({ user });
});

router.delete("/me", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select("_id");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const chats = await Chat.find({ members: userId }).select("_id type members createdBy");
    const directChatIds = chats
      .filter((chat) => chat.type === "direct")
      .map((chat) => chat._id);

    if (directChatIds.length > 0) {
      await Message.deleteMany({ chatId: { $in: directChatIds } });
      await Chat.deleteMany({ _id: { $in: directChatIds } });
    }

    const groupChats = chats.filter((chat) => chat.type === "group");
    for (const chat of groupChats) {
      const remainingMembers = chat.members.filter((memberId) => String(memberId) !== String(userId));

      if (remainingMembers.length === 0) {
        await Message.deleteMany({ chatId: chat._id });
        await Chat.deleteOne({ _id: chat._id });
        continue;
      }

      const update = { members: remainingMembers };
      if (String(chat.createdBy) === String(userId)) {
        update.createdBy = remainingMembers[0];
      }
      await Chat.updateOne({ _id: chat._id }, update);
    }

    await ChatRequest.deleteMany({
      $or: [{ from: userId }, { to: userId }]
    });

    await Message.deleteMany({ senderId: userId });
    await User.deleteOne({ _id: userId });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete account" });
  }
});

export default router;

