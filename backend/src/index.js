// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import http from "http";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import morgan from "morgan";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import requestRoutes from "./routes/requests.js";
import chatRoutes from "./routes/chats.js";
import messageRoutes from "./routes/messages.js";
import uploadRoutes from "./routes/upload.js";
import emojiRoutes from "./routes/emojis.js";
import { initSocket } from "./socket/index.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

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

const configuredOrigins = parseOrigins(process.env.CLIENT_ORIGIN);
const allowedOrigins = process.env.NODE_ENV === "production"
  ? (configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_DEV_ORIGINS)
  : Array.from(new Set([...DEFAULT_DEV_ORIGINS, ...configuredOrigins]));

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

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && isDevLanOrigin(origin)) return true;
  return false;
}

function corsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) {
    return callback(null, true);
  }
  return callback(null, false);
}

app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/emojis", emojiRoutes);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
  console.error("MONGO_URI is required");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("JWT_SECRET is required");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    initSocket(server, { origin: corsOrigin });

    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(`Server start failed: port ${PORT} is already in use`);
        process.exit(1);
      }
      console.error("Server error:", err);
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed", err);
    process.exit(1);
  });

