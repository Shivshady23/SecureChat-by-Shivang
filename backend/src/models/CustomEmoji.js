// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";

const CustomEmojiSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true, unique: true },
    url: { type: String, required: true, trim: true },
    keywords: [{ type: String, trim: true, lowercase: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("CustomEmoji", CustomEmojiSchema);


