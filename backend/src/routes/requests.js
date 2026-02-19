// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import express from "express";
import mongoose from "mongoose";
import ChatRequest from "../models/ChatRequest.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  const incoming = await ChatRequest.find({ to: req.user.id })
    .populate("from", "_id name username avatarUrl")
    .sort({ createdAt: -1 });
  const outgoing = await ChatRequest.find({ from: req.user.id })
    .populate("to", "_id name username avatarUrl")
    .sort({ createdAt: -1 });
  return res.json({ incoming, outgoing });
});

router.post("/", authRequired, async (req, res) => {
  try {
    const { toUserId } = req.body || {};
    if (!toUserId || typeof toUserId !== "string") {
      return res.status(400).json({ message: "toUserId is required" });
    }

    if (String(toUserId) === String(req.user.id)) {
      return res.status(400).json({ message: "Cannot request yourself" });
    }
    if (!mongoose.Types.ObjectId.isValid(toUserId)) {
      return res.status(400).json({ message: "Invalid recipient id" });
    }

    const targetUserExists = await User.exists({ _id: toUserId });
    if (!targetUserExists) {
      return res.status(404).json({ message: "Recipient user not found" });
    }

    const existingChat = await Chat.findOne({
      type: "direct",
      members: { $all: [req.user.id, toUserId] }
    });
    if (existingChat) {
      const populated = await Chat.findById(existingChat._id).populate("members", "_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");
      return res.json({ status: "accepted", chat: populated });
    }

    const incomingPending = await ChatRequest.findOne({
      from: toUserId,
      to: req.user.id,
      status: "pending"
    });
    if (incomingPending) {
      incomingPending.status = "accepted";
      await incomingPending.save();

      let chat = await Chat.findOne({
        type: "direct",
        members: { $all: [req.user.id, toUserId] }
      });
      if (!chat) {
        chat = await Chat.create({
          type: "direct",
          members: [req.user.id, toUserId],
          createdBy: toUserId
        });
      }

      const populated = await Chat.findById(chat._id).populate("members", "_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");
      return res.json({ status: "accepted", chat: populated });
    }

    const existing = await ChatRequest.findOne({ from: req.user.id, to: toUserId });
    if (existing) {
      if (existing.status === "rejected") {
        existing.status = "pending";
        await existing.save();
      }
      return res.json({ request: existing });
    }

    const request = await ChatRequest.create({ from: req.user.id, to: toUserId, status: "pending" });
    return res.json({ request });
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await ChatRequest.findOne({ from: req.user.id, to: req.body?.toUserId });
      if (existing) {
        return res.json({ request: existing });
      }
      return res.status(409).json({ message: "Request already exists" });
    }
    return res.status(500).json({ message: "Failed to send request" });
  }
});

router.post("/:id/respond", authRequired, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const request = await ChatRequest.findById(req.params.id);
    if (!request || String(request.to) !== String(req.user.id)) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = status;
    await request.save();

    let chat = null;
    if (status === "accepted") {
      chat = await Chat.findOne({
        type: "direct",
        members: { $all: [request.from, request.to] }
      });
      if (!chat) {
        chat = await Chat.create({
          type: "direct",
          members: [request.from, request.to],
          createdBy: request.from
        });
      }
    }

    if (chat) {
      chat = await Chat.findById(chat._id).populate("members", "_id name username publicKeyJwk e2eePublicKeySpkiB64 e2eeKeyVersion about avatarUrl");
    }

    return res.json({ request, chat });
  } catch (err) {
    return res.status(500).json({ message: "Failed to respond to request" });
  }
});

export default router;

