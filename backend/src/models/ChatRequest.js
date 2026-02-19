// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";

const ChatRequestSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" }
  },
  { timestamps: true }
);

ChatRequestSchema.index({ from: 1, to: 1 }, { unique: true });

export default mongoose.model("ChatRequest", ChatRequestSchema);

