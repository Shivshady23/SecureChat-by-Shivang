// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useState } from "react";
import { createCustomEmoji } from "../services/emoji.js";

export default function CustomEmojiAdmin({ onCreated }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await createCustomEmoji({
        name: name.trim(),
        url: url.trim(),
        keywords: keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      });
      setName("");
      setUrl("");
      setKeywords("");
      onCreated?.(res?.custom);
    } catch (err) {
      setError(err?.message || "Failed to create custom emoji");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="custom-emoji-admin" onSubmit={submit}>
      <h3>Custom Emoji</h3>
      <input
        className="form-input"
        placeholder="emoji_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className="form-input"
        placeholder="https://... or /uploads/..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      <input
        className="form-input"
        placeholder="keywords, comma separated"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
      />
      {error ? <div className="error">{error}</div> : null}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Saving..." : "Add Emoji"}
      </button>
    </form>
  );
}


