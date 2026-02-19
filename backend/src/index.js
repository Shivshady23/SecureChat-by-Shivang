// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import http from "http";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createApp, createCorsOrigin } from "./app.js";
import { initSocket } from "./socket/index.js";

dotenv.config();

const corsOrigin = createCorsOrigin(process.env.CLIENT_ORIGIN);
const app = createApp({ corsOrigin });
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
  console.error("MONGO_URI is required");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("JWT_SECRET is required");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    initSocket(server, { origin: corsOrigin });

    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(`Server start failed: port ${PORT} is already in use`);
        process.exit(1);
      }
      console.error("Server error:", err);
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed", err);
    process.exit(1);
  });

