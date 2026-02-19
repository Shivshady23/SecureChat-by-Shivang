// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    type: { type: String, enum: ["text", "image", "file"], required: true },
    content: { type: String, default: "" },
    encrypted: { type: Boolean, default: false },
    iv: { type: String, default: "" },
    ciphertextB64: { type: String, default: "" },
    wrappedKeyB64: { type: String, default: "" },
    senderWrappedKeyB64: { type: String, default: "" },
    aadB64: { type: String, default: "" },
    clientTs: { type: Number, default: 0 },
    clientMsgId: { type: String, default: "" },
    integrityHash: { type: String, default: "" },
    fileKey: { type: String, default: "" },
    fileUrl: { type: String, default: "" },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    fileSize: { type: Number, default: 0 },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    disappearsAfterReadAll: { type: Boolean, default: false },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        emoji: { type: String, required: true }
      }
    ],
    editedAt: { type: Date, default: null },
    senderPublicKeyJwk: { type: Object, default: null },
    recipientPublicKeyJwk: { type: Object, default: null }
  },
  { timestamps: true }
);

MessageSchema.index(
  { senderId: 1, clientMsgId: 1 },
  { unique: true, partialFilterExpression: { clientMsgId: { $exists: true, $ne: "" } } }
);

export default mongoose.model("Message", MessageSchema);

