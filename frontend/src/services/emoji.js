// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { api } from "./api.js";

export async function fetchEmojiMeta() {
  return api("/api/emojis");
}

export async function trackRecentEmoji(emoji) {
  return api("/api/emojis/recent", {
    method: "POST",
    body: JSON.stringify({ emoji })
  });
}

export async function createCustomEmoji({ name, url, keywords = [] }) {
  return api("/api/emojis/custom", {
    method: "POST",
    body: JSON.stringify({ name, url, keywords })
  });
}


