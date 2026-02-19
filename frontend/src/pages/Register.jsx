// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../services/api.js";
import {
  getTheme,
  setTheme,
  setToken,
  setUser
} from "../services/storage.js";

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      const cleanName = name.trim();
      const cleanUsername = username.trim();
      if (!cleanName || !cleanUsername || !password) {
        setError("Name, username, and password are required.");
        return;
      }
      const res = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: cleanName,
          username: cleanUsername,
          password
        })
      });
      setToken(res.token);
      setUser(res.user);
      navigate("/chat");
    } catch (err) {
      setError(err.message);
    } finally {
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
          <div className="auth-icon">{"\u2728"}</div>
          <h1>Join SecureChat</h1>
          <p className="auth-subtitle">Create your encrypted messaging account</p>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <form onSubmit={onSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <div className="input-wrapper">
              <span className="input-icon">{"\uD83D\uDC64"}</span>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <span className="input-icon">@</span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="john_doe_2024"
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? (
              <span className="loading">Creating account...</span>
            ) : (
              <>
                <span>Create Account</span>
                <span className="button-arrow">{"\u2192"}</span>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>Already have an account? <Link to="/login">Login</Link></p>
        </div>

        <div className="security-note">
          {"\uD83D\uDD10"} Your encryption key pair is created locally on first login. Private keys never leave your device.
        </div>
      </div>
    </div>
  );
}

