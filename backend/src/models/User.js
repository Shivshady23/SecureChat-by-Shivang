// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    publicKeyJwk: { type: Object, default: null }, // legacy field
    e2eePublicKeySpkiB64: { type: String, default: "" },
    e2eeKeyVersion: { type: Number, default: 1 },
    about: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    isAdmin: { type: Boolean, default: false },
    emojiRecent: [{ type: String }]
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);

