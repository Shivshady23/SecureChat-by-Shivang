// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { io } from "socket.io-client";
import { getToken } from "./storage.js";
import { SOCKET_URL } from "./runtimeConfig.js";

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    auth: { token: getToken() }
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

