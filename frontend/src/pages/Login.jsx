// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { getTheme, setTheme, setToken, setUser } from "../services/storage.js";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [theme, setThemeLocal] = useState(getTheme());

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    setThemeLocal(nextTheme);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const cleanUsername = username.trim();
      if (!cleanUsername || !password) {
        setError("Username and password are required.");
        setLoading(false);
        return;
      }
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: cleanUsername, password })
      });
      setToken(res.token);
      setUser(res.user);
      setLoading(false);
      navigate("/chat");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-background"></div>
      <div className="auth-card">
        <div className="auth-theme-row">
          <button
            type="button"
            className="auth-theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
        <div className="auth-header">
          <div className="auth-icon">{"\uD83D\uDCAC"}</div>
          <h1>SecureChat</h1>
          <p className="auth-subtitle">End-to-end encrypted messaging</p>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <form onSubmit={onSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <span className="input-icon">{"\uD83D\uDC64"}</span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <span className="input-icon">{"\uD83D\uDD12"}</span>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                disabled={loading}
              >
                {showPassword ? (
                  <svg
                    className="password-toggle-icon"
                    viewBox="0 0 16 12"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M1 6s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z" />
                    <circle cx="8" cy="6" r="2.1" />
                    <path d="M2 11L14 1" />
                  </svg>
                ) : (
                  <svg
                    className="password-toggle-icon"
                    viewBox="0 0 16 12"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M1 6s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z" />
                    <circle cx="8" cy="6" r="2.1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? (
              <span className="loading">Signing in...</span>
            ) : (
              <>
                <span>Login</span>
                <span className="button-arrow">{"\u2192"}</span>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account? <Link to="/register">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
