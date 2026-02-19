// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

const TOKEN_KEY = "sc_token";
const USER_KEY = "sc_user";
const PRIVATE_KEY = "sc_private_jwk";
const THEME_KEY = "sc_theme";

// Custom event emitter for token changes
const tokenChangeEvent = new Event("tokenchange");
const themeChangeEvent = new Event("themechange");

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(tokenChangeEvent);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(tokenChangeEvent);
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(themeChangeEvent);
}

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

export function clearTheme() {
  localStorage.removeItem(THEME_KEY);
  window.dispatchEvent(themeChangeEvent);
}

export function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearUser() {
  localStorage.removeItem(USER_KEY);
}

export function setPrivateKeyJwk(jwk) {
  localStorage.setItem(PRIVATE_KEY, JSON.stringify(jwk));
}

export function getPrivateKeyJwk() {
  const raw = localStorage.getItem(PRIVATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearPrivateKeyJwk() {
  localStorage.removeItem(PRIVATE_KEY);
}

export function clearAuth() {
  clearToken();
  clearUser();
}

