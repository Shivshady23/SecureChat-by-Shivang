// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";

const CallHistorySchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["voice", "video"], required: true },
    status: { type: String, enum: ["missed", "rejected", "completed"], required: true },
    duration: { type: Number, default: 0 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model("CallHistory", CallHistorySchema);

