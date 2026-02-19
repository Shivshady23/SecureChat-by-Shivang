// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findUserByUsername(username) {
  const cleanUsername = typeof username === "string" ? username.trim() : "";
  if (!cleanUsername) return null;

  const exactMatch = await User.findOne({ username: cleanUsername });
  if (exactMatch) return exactMatch;

  const regex = new RegExp(`^${escapeRegex(cleanUsername)}$`, "i");
  return User.findOne({ username: regex });
}

router.post("/register", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server misconfigured: JWT_SECRET missing" });
    }
    const { name, username, password } = req.body;
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanUsername = typeof username === "string" ? username.trim() : "";
    if (!cleanName || !cleanUsername || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const caseInsensitiveExisting = await findUserByUsername(cleanUsername);
    if (caseInsensitiveExisting) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: cleanName,
      username: cleanUsername,
      passwordHash
    });

    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: "7d"
    });

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        publicKeyJwk: user.publicKeyJwk || null,
        e2eePublicKeySpkiB64: user.e2eePublicKeySpkiB64 || "",
        e2eeKeyVersion: user.e2eeKeyVersion || 1,
        about: user.about || "",
        avatarUrl: user.avatarUrl || "",
        isAdmin: Boolean(user.isAdmin)
      }
    });
  } catch (err) {
    if (err?.code === 11000 || err?.keyPattern?.username) {
      return res.status(409).json({ message: "Username already taken" });
    }
    console.error("Registration error:", err);
    return res.status(500).json({ message: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server misconfigured: JWT_SECRET missing" });
    }
    const { username, password } = req.body;
    const cleanUsername = typeof username === "string" ? username.trim() : "";
    if (!cleanUsername || !password) {
      return res.status(400).json({ message: "Missing username or password" });
    }

    const user = await findUserByUsername(cleanUsername);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: "7d"
    });

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        publicKeyJwk: user.publicKeyJwk || null,
        e2eePublicKeySpkiB64: user.e2eePublicKeySpkiB64 || "",
        e2eeKeyVersion: user.e2eeKeyVersion || 1,
        about: user.about || "",
        avatarUrl: user.avatarUrl || "",
        isAdmin: Boolean(user.isAdmin)
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Login failed" });
  }
});

export default router;

