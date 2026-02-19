// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import bcrypt from "bcryptjs";

export async function verifyLockPassword(req, res, next) {
  const passwordDigest = String(req.body?.passwordDigest || "").trim();
  if (!passwordDigest) {
    return res.status(400).json({ message: "passwordDigest is required" });
  }

  const chat = req.chat;
  if (!chat || !chat.isLocked || !chat.lockPasswordHash) {
    return res.status(400).json({ message: "Chat is not locked" });
  }

  const isValid = await bcrypt.compare(passwordDigest, chat.lockPasswordHash);
  if (!isValid) {
    return res.status(401).json({ message: "Invalid lock password" });
  }

  return next();
}


