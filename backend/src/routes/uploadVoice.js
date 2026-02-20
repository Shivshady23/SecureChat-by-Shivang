// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import fs from "fs";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootUploadDir = path.join(__dirname, "..", "..", "uploads");
const voiceUploadDir = path.join(rootUploadDir, "voice");
fs.mkdirSync(voiceUploadDir, { recursive: true });

const VOICE_MAX_BYTES = 5 * 1024 * 1024;
const SAFE_FILE_KEY_PATTERN = /^[a-z0-9-]+\.[a-z0-9]{1,10}$/i;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav"
]);
const AUDIO_EXTENSIONS = new Set([".webm", ".ogg", ".mp3", ".mp4", ".aac", ".wav"]);

function normalizeMimeType(rawMimeType) {
  return String(rawMimeType || "")
    .trim()
    .toLowerCase();
}

function normalizeFileName(rawName) {
  const baseName = path.basename(String(rawName || "voice-message"));
  const extension = path.extname(baseName);
  const nameOnly = baseName.slice(0, Math.max(0, baseName.length - extension.length));
  const safeNameOnly = nameOnly
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 64) || "voice-message";
  const safeExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 10);
  return `${safeNameOnly}${safeExtension}`;
}

function isAllowedVoiceUpload({ mimeType, extension }) {
  if (ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) return true;
  return AUDIO_EXTENSIONS.has(extension);
}

function resolvePreferredExtension({ mimeType, originalName }) {
  const extFromOriginal = path.extname(String(originalName || "")).toLowerCase();
  if (AUDIO_EXTENSIONS.has(extFromOriginal)) return extFromOriginal;
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("aac")) return ".aac";
  if (mimeType.includes("mp4")) return ".mp4";
  return ".webm";
}

function getAudioMimeFromExtension(fileKey) {
  const ext = path.extname(String(fileKey || "")).toLowerCase();
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".mp4") return "audio/mp4";
  return "audio/webm";
}

function authRequiredForVoice(req, res, next) {
  const header = String(req.headers.authorization || "");
  const headerToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const queryToken = String(req.query?.token || "").trim();
  const token = headerToken || queryToken;

  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, voiceUploadDir),
  filename: (req, file, cb) => {
    const mimeType = normalizeMimeType(req.body?.originalMimeType || file.mimetype);
    const ext = resolvePreferredExtension({
      mimeType,
      originalName: req.body?.originalName || file.originalname
    });
    cb(null, `${uuid()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: VOICE_MAX_BYTES }
});

router.post("/", authRequiredForVoice, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Voice message size must be 5MB or smaller." });
    }
    return res.status(400).json({ message: err.message || "Invalid voice upload request" });
  });
}, (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "Voice file is missing." });
  }

  const originalName = normalizeFileName(req.body?.originalName || file.originalname || "voice-message.webm");
  const mimeType = normalizeMimeType(req.body?.originalMimeType || file.mimetype);
  const extension = path.extname(originalName).toLowerCase();

  if (!isAllowedVoiceUpload({ mimeType, extension })) {
    try {
      fs.unlinkSync(path.join(voiceUploadDir, file.filename));
    } catch {}
    return res.status(400).json({ message: "Only audio files are allowed for voice messages." });
  }

  return res.json({
    fileKey: file.filename,
    fileName: originalName,
    mimeType: mimeType || getAudioMimeFromExtension(file.filename),
    size: file.size,
    type: "voice",
    url: `/api/upload-voice/${file.filename}`
  });
});

router.get("/:fileKey", authRequiredForVoice, (req, res) => {
  const fileKey = String(req.params.fileKey || "").trim();
  if (!SAFE_FILE_KEY_PATTERN.test(fileKey)) {
    return res.status(400).json({ message: "Invalid file key" });
  }

  const filePath = path.resolve(voiceUploadDir, fileKey);
  if (!filePath.startsWith(path.resolve(voiceUploadDir))) {
    return res.status(400).json({ message: "Invalid file path" });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File not found" });
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const mimeType = getAudioMimeFromExtension(fileKey);
  const range = String(req.headers.range || "").trim();

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("Content-Type", mimeType);

  if (range && range.startsWith("bytes=")) {
    const [startRaw, endRaw] = range.replace("bytes=", "").split("-");
    const start = Number.parseInt(startRaw, 10);
    const end = endRaw ? Number.parseInt(endRaw, 10) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= total) {
      return res.status(416).end();
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(chunkSize));
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.setHeader("Content-Length", String(total));
  return fs.createReadStream(filePath).pipe(res);
});

export default router;
