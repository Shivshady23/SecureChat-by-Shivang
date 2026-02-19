// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const FILE_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "application/rtf",
  "application/octet-stream"
]);
const BLOCKED_FILE_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".scr",
  ".ps1",
  ".sh",
  ".jar",
  ".apk"
]);

const IMAGE_MAX_MB = Math.max(1, Number.parseInt(process.env.IMAGE_UPLOAD_MAX_MB || "10", 10) || 10);
const FILE_MAX_MB = Math.max(1, Number.parseInt(process.env.FILE_UPLOAD_MAX_MB || "50", 10) || 50);
const MAX_UPLOAD_BYTES = Math.max(IMAGE_MAX_MB, FILE_MAX_MB) * 1024 * 1024;

function getRequestedUploadType(req) {
  const requested = String(req.body?.uploadType || "").trim().toLowerCase();
  if (requested === "image" || requested === "file") return requested;
  return "";
}

function normalizeMimeType(rawMimeType) {
  return String(rawMimeType || "").trim().toLowerCase();
}

function isAllowedImageType(mimeType, extension) {
  return IMAGE_MIME_TYPES.has(mimeType) || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension);
}

function isAllowedFileType(mimeType, extension) {
  if (BLOCKED_FILE_EXTENSIONS.has(extension)) return false;
  if (!mimeType) return true;
  if (FILE_MIME_TYPES.has(mimeType)) return true;
  if (IMAGE_MIME_TYPES.has(mimeType)) return true;
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType.startsWith("text/");
}

function validateUploadedFile(req, file) {
  const extension = path.extname(String(req.body?.originalName || file.originalname || "")).toLowerCase();
  const originalMimeType = normalizeMimeType(req.body?.originalMimeType || file.mimetype);
  const uploadType = getRequestedUploadType(req) || (isAllowedImageType(originalMimeType, extension) ? "image" : "file");
  const imageMaxBytes = IMAGE_MAX_MB * 1024 * 1024;
  const fileMaxBytes = FILE_MAX_MB * 1024 * 1024;

  if (uploadType === "image") {
    if (!isAllowedImageType(originalMimeType, extension)) {
      return { ok: false, message: "Only jpg, jpeg, png, webp and gif images are allowed." };
    }
    if (file.size > imageMaxBytes) {
      return { ok: false, message: `Image size limit is ${IMAGE_MAX_MB}MB.` };
    }
    return { ok: true, uploadType, originalMimeType };
  }

  if (!isAllowedFileType(originalMimeType, extension)) {
    return { ok: false, message: "This file type is not allowed." };
  }
  if (file.size > fileMaxBytes) {
    return { ok: false, message: `File size limit is ${FILE_MAX_MB}MB.` };
  }
  return { ok: true, uploadType: "file", originalMimeType };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const key = `${uuid()}${ext}`;
    cb(null, key);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

router.post("/", authRequired, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: `File too large. Maximum allowed is ${FILE_MAX_MB}MB.` });
    }
    return res.status(400).json({ message: err.message || "Invalid upload request" });
  });
}, (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: "File missing" });

  const validation = validateUploadedFile(req, file);
  if (!validation.ok) {
    try {
      fs.unlinkSync(path.join(uploadDir, file.filename));
    } catch {}
    return res.status(400).json({ message: validation.message });
  }

  return res.json({
    fileKey: file.filename,
    fileName: req.body?.originalName || file.originalname,
    mimeType: validation.originalMimeType || file.mimetype,
    size: file.size,
    type: validation.uploadType,
    url: `/uploads/${file.filename}`
  });
});

router.get("/:fileKey", authRequired, (req, res) => {
  const filePath = path.join(uploadDir, req.params.fileKey);
  return res.sendFile(filePath, (err) => {
    if (err) {
      return res.status(404).end();
    }
  });
});

export default router;

