// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { API_BASE } from "../services/runtimeConfig.js";

function normalizeBase(url) {
  return String(url || "").replace(/\/+$/, "");
}

export function getAvatarSrc(avatarUrl) {
  const raw = String(avatarUrl || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  const base = normalizeBase(API_BASE);
  if (!base) return raw;
  return raw.startsWith("/") ? `${base}${raw}` : `${base}/${raw}`;
}

