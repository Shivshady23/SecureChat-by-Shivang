// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

function normalizeBase(url) {
  return String(url || "").replace(/\/+$/, "");
}

function isLoopbackHost(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function getCurrentHostname() {
  if (typeof window === "undefined") return "localhost";
  return window.location.hostname || "localhost";
}

function getCurrentProtocol() {
  if (typeof window === "undefined") return "http:";
  return window.location.protocol || "http:";
}

function getDefaultBackendBase() {
  const hostname = getCurrentHostname();
  const protocol = getCurrentProtocol() === "https:" ? "https:" : "http:";
  const hostForBackend = isLoopbackHost(hostname) ? "localhost" : hostname;
  return `${protocol}//${hostForBackend}:5001`;
}

function remapLoopbackToCurrentHost(url) {
  const hostname = getCurrentHostname();
  if (isLoopbackHost(hostname)) {
    return normalizeBase(url);
  }

  try {
    const parsed = new URL(url);
    if (!isLoopbackHost(parsed.hostname)) {
      return normalizeBase(url);
    }
    parsed.hostname = hostname;
    return normalizeBase(parsed.toString());
  } catch {
    return normalizeBase(url);
  }
}

function resolveBackendBase(envValue) {
  const configured = normalizeBase(envValue);
  const fallback = getDefaultBackendBase();
  const chosen = configured || fallback;
  return remapLoopbackToCurrentHost(chosen);
}

export const API_BASE = resolveBackendBase(process.env.REACT_APP_API_BASE);
export const SOCKET_URL = resolveBackendBase(
  process.env.REACT_APP_SOCKET_URL || process.env.REACT_APP_API_BASE
);
export const TURN_URL = String(process.env.REACT_APP_TURN_URL || "").trim();
export const TURN_USERNAME = String(process.env.REACT_APP_TURN_USERNAME || "").trim();
export const TURN_CREDENTIAL = String(process.env.REACT_APP_TURN_CREDENTIAL || "").trim();


