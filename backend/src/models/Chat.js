// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";

const ChatSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["direct", "group"], required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String, default: "" },
    motive: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    isLocked: { type: Boolean, default: false },
    // Sensitive: never return lock hashes in regular query results.
    lockPasswordHash: { type: String, default: "", select: false },
    vanishMode: { type: Boolean, default: false },
    pinnedMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    lastMessageAt: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model("Chat", ChatSchema);

