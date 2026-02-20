// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import "express-async-errors";
import path from "path";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import requestRoutes from "./routes/requests.js";
import chatRoutes from "./routes/chats.js";
import messageRoutes from "./routes/messages.js";
import uploadRoutes from "./routes/upload.js";
import uploadVoiceRoutes from "./routes/uploadVoice.js";
import emojiRoutes from "./routes/emojis.js";

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPrivateIpv4(hostname) {
  const value = String(hostname || "");
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(value)
  );
}

function isDevLanOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;

    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    if (!["3000", "5173"].includes(String(port))) return false;

    const hostname = String(parsed.hostname || "").toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
    if (hostname.endsWith(".local")) return true;
    if (isPrivateIpv4(hostname)) return true;
    return /^[a-z0-9-]+$/i.test(hostname);
  } catch {
    return false;
  }
}

function createOriginChecker({ configuredOrigin = "" } = {}) {
  const configuredOrigins = parseOrigins(configuredOrigin);
  const allowedOrigins =
    process.env.NODE_ENV === "production"
      ? configuredOrigins.length > 0
        ? configuredOrigins
        : DEFAULT_DEV_ORIGINS
      : Array.from(new Set([...DEFAULT_DEV_ORIGINS, ...configuredOrigins]));

  return function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (process.env.NODE_ENV !== "production" && isDevLanOrigin(origin)) return true;
    return false;
  };
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = String(key || "");
    if (!normalizedKey) continue;
    if (normalizedKey.startsWith("$")) continue;
    if (normalizedKey.includes(".")) continue;
    output[normalizedKey] = sanitizeValue(nested);
  }
  return output;
}

function requestSanitizer(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeValue(req.query);
  }
  next();
}

export function createCorsOrigin(configuredOrigin) {
  const isAllowedOrigin = createOriginChecker({ configuredOrigin });
  return function corsOrigin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

export function createApp({ corsOrigin } = {}) {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const safeCorsOrigin = corsOrigin || createCorsOrigin(process.env.CLIENT_ORIGIN || "");
  const authLimitMax = Math.max(5, Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || "40", 10) || 40);
  const apiLimitPerMinute = Math.max(
    30,
    Number.parseInt(process.env.API_RATE_LIMIT_PER_MIN || "400", 10) || 400
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: authLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: apiLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: false
    })
  );
  app.use(
    cors({
      origin: safeCorsOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "2mb" }));
  app.use(morgan("dev"));
  app.use(requestSanitizer);
  app.use(apiLimiter);

  app.use("/uploads/voice", (req, res) => {
    return res.status(403).json({ message: "Voice files require authorized access." });
  });
  app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

  app.get("/", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/requests", requestRoutes);
  app.use("/api/chats", chatRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/upload-voice", uploadVoiceRoutes);
  app.use("/api/emojis", emojiRoutes);

  app.use((err, req, res, next) => {
    if (!err) return next();

    if (err?.name === "CastError") {
      return res.status(400).json({ message: "Invalid identifier format" });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message || "Validation failed" });
    }
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Uploaded file exceeds allowed size limit" });
    }

    console.error("Unhandled server error:", err);
    return res.status(500).json({ message: "Internal server error" });
  });

  return app;
}
