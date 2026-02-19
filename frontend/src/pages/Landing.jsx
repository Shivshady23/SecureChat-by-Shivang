// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { Link } from "react-router-dom";

const FEATURES = [
  "End-to-end encrypted direct messaging",
  "Private/locked chats with password access",
  "Emoji picker and reactions",
  "Real-time messaging with Socket.io",
  "Group chats with admin controls",
  "Typing indicators, read receipts, and media sharing"
];

export default function Landing() {
  return (
    <div className="landing-page">
      <div className="landing-bg" />
      <main className="landing-card">
        <h1 className="landing-main-name">SecureChat</h1>
        <h2 className="landing-tagline">Private messaging built for security and speed</h2>
        <p className="landing-subtitle">
          Connect instantly, protect every conversation, and manage personal or group chats with modern controls.
        </p>

        <section className="landing-features" aria-label="Application features">
          {FEATURES.map((feature) => (
            <article key={feature} className="landing-feature-item">
              <span className="landing-feature-dot" aria-hidden="true" />
              <span>{feature}</span>
            </article>
          ))}
        </section>

        <div className="landing-actions">
          <Link to="/login" className="landing-btn primary">
            Login
          </Link>
          <Link to="/register" className="landing-btn secondary">
            Create Account
          </Link>
        </div>
      </main>
    </div>
  );
}

