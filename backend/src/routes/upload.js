// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "..", "uploads");

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
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post("/", authRequired, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File missing" });
  }

  return res.json({
    fileKey: req.file.filename,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    url: `/uploads/${req.file.filename}`
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

