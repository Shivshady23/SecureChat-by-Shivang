// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import { authRequired } from "../middleware/auth.js";
import User from "../models/User.js";
import CustomEmoji from "../models/CustomEmoji.js";

const router = express.Router();
const MAX_RECENTS = 40;
const MAX_EMOJI_LENGTH = 48;

router.get("/", authRequired, async (req, res) => {
  const [user, customEmojis] = await Promise.all([
    User.findById(req.user.id).select("emojiRecent"),
    CustomEmoji.find({ isActive: true })
      .sort({ name: 1 })
      .select("_id name url keywords")
  ]);

  return res.json({
    recent: Array.isArray(user?.emojiRecent) ? user.emojiRecent : [],
    custom: customEmojis.map((entry) => ({
      id: String(entry._id),
      name: entry.name,
      shortcodes: `:${entry.name}:`,
      keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
      skins: [{ src: entry.url }]
    }))
  });
});

router.post("/recent", authRequired, async (req, res) => {
  const emoji = String(req.body?.emoji || "").trim();
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) {
    return res.status(400).json({ message: "Invalid emoji" });
  }

  const user = await User.findById(req.user.id).select("emojiRecent");
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const current = Array.isArray(user.emojiRecent) ? user.emojiRecent : [];
  user.emojiRecent = [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, MAX_RECENTS);
  await user.save();

  return res.json({ recent: user.emojiRecent });
});

router.post("/custom", authRequired, async (req, res) => {
  const actor = await User.findById(req.user.id).select("isAdmin");
  if (!actor?.isAdmin) {
    return res.status(403).json({ message: "Only admin can add custom emoji" });
  }

  const name = String(req.body?.name || "").trim().toLowerCase();
  const url = String(req.body?.url || "").trim();
  const keywords = Array.isArray(req.body?.keywords)
    ? req.body.keywords.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];

  if (!name || !/^[a-z0-9_+-]{2,40}$/.test(name)) {
    return res.status(400).json({ message: "Invalid emoji name" });
  }
  if (!url || !/^https?:\/\/|^\/uploads\//i.test(url)) {
    return res.status(400).json({ message: "Invalid emoji URL" });
  }

  const created = await CustomEmoji.create({
    name,
    url,
    keywords,
    createdBy: req.user.id,
    isActive: true
  });

  return res.status(201).json({
    custom: {
      id: String(created._id),
      name: created.name,
      shortcodes: `:${created.name}:`,
      keywords: created.keywords || [],
      skins: [{ src: created.url }]
    }
  });
});

export default router;


