// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useMemo, useRef, useState } from "react";
import EmojiPickerPanel from "./EmojiPickerPanel";
import { fetchEmojiMeta, trackRecentEmoji } from "../services/emoji.js";

const MAX_SUGGESTIONS = 8;

function getAutocompleteMatch(text, cursorPos) {
  const before = text.slice(0, cursorPos);
  const match = before.match(/(?:^|\s):([a-z0-9_+-]{1,32})$/i);
  if (!match) return null;
  const query = String(match[1] || "").toLowerCase();
  const fullMatch = String(match[0] || "");
  const colonIdxInMatch = fullMatch.lastIndexOf(":");
  const start = cursorPos - (fullMatch.length - colonIdxInMatch);
  return { query, start, end: cursorPos };
}

function getCaretCoordinates(textarea, position) {
  const div = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  const props = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing"
  ];
  props.forEach((prop) => {
    div.style[prop] = style[prop];
  });
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.overflow = "hidden";
  div.textContent = textarea.value.slice(0, position);
  const span = document.createElement("span");
  span.textContent = textarea.value.slice(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const rect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
  const result = {
    x: rect.left - divRect.left + textarea.offsetLeft - textarea.scrollLeft,
    y: rect.top - divRect.top + textarea.offsetTop - textarea.scrollTop
  };
  document.body.removeChild(div);
  return result;
}

export default function MessageInput({
  onSendText,
  onSendFile,
  onSaveEdit,
  onTyping,
  vanishMode = false,
  replyTarget = null,
  onCancelReply,
  editTarget = null,
  onCancelEdit
}) {
  const [text, setText] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState([]);
  const [customEmojis, setCustomEmojis] = useState([]);
  const [emojiIndex, setEmojiIndex] = useState([]);
  const [autocomplete, setAutocomplete] = useState(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const typingTimeout = useRef(null);
  const autocompleteDebounceRef = useRef(null);
  const textareaRef = useRef(null);
  const composerRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadEmojiMeta() {
      try {
        const response = await fetchEmojiMeta();
        if (cancelled) return;
        setRecentEmojis(Array.isArray(response?.recent) ? response.recent : []);
        setCustomEmojis(Array.isArray(response?.custom) ? response.custom : []);
      } catch {}
    }
    loadEmojiMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("@emoji-mart/data")
      .then((module) => {
        if (cancelled) return;
        const data = module?.default || module;
        const next = Object.values(data?.emojis || {}).map((entry) => ({
          id: String(entry.id || ""),
          native: String(entry.skins?.[0]?.native || ""),
          name: String(entry.name || ""),
          keywords: Array.isArray(entry.keywords) ? entry.keywords : []
        }));
        setEmojiIndex(next);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editTarget?.text) {
      setText(editTarget.text);
      setShowEmojis(false);
      setAutocomplete(null);
      clearPendingFile();
    }
  }, [editTarget?.messageId]);

  useEffect(() => {
    autoResizeTextarea();
  }, [text]);

  useEffect(() => {
    return () => {
      if (autocompleteDebounceRef.current) clearTimeout(autocompleteDebounceRef.current);
    };
  }, []);

  function autoResizeTextarea() {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = "auto";
    const nextHeight = Math.min(140, Math.max(44, input.scrollHeight));
    input.style.height = `${nextHeight}px`;
  }

  function clearPendingFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setPendingFile(null);
  }

  function setPendingUpload(file) {
    if (!file) return;
    clearPendingFile();
    setPendingFile(file);
    if (file.type?.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    }
  }

  function sendPendingFile() {
    if (!pendingFile) return;
    onSendFile(pendingFile);
    clearPendingFile();
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (editTarget?.messageId) {
      if (!text.trim()) return;
      onSaveEdit?.(text.trim());
      setText("");
      setShowEmojis(false);
      setAutocomplete(null);
      onTyping(false);
      return;
    }
    if (text.trim()) {
      onSendText(text.trim());
      setText("");
      setShowEmojis(false);
      setAutocomplete(null);
      onTyping(false);
      return;
    }
    if (pendingFile) {
      sendPendingFile();
    }
  }

  function cacheSelection() {
    const input = textareaRef.current;
    if (!input) return;
    selectionRef.current = {
      start: input.selectionStart || 0,
      end: input.selectionEnd || 0
    };
  }

  function insertValueAtCursor(value, rangeOverride = null) {
    const input = textareaRef.current;
    const current = text;
    const start = rangeOverride?.start ?? (input ? input.selectionStart : selectionRef.current.start);
    const end = rangeOverride?.end ?? (input ? input.selectionEnd : selectionRef.current.end);
    const safeStart = Number.isFinite(start) ? start : current.length;
    const safeEnd = Number.isFinite(end) ? end : current.length;
    const next = `${current.slice(0, safeStart)}${value}${current.slice(safeEnd)}`;
    setText(next);

    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      const cursor = safeStart + value.length;
      target.focus();
      target.setSelectionRange(cursor, cursor);
      selectionRef.current = { start: cursor, end: cursor };
      autoResizeTextarea();
    });
  }

  async function rememberEmoji(emojiValue) {
    const emoji = String(emojiValue || "").trim();
    if (!emoji) return;
    setRecentEmojis((prev) => [emoji, ...prev.filter((entry) => entry !== emoji)].slice(0, 40));
    try {
      await trackRecentEmoji(emoji);
    } catch {}
  }

  function applySelectedEmoji(emojiData) {
    const native = String(emojiData?.native || "").trim();
    const customShortcode = emojiData?.id ? `:${emojiData.id}:` : "";
    const value = native || customShortcode;
    if (!value) return;
    insertValueAtCursor(value);
    setShowEmojis(false);
    setAutocomplete(null);
    rememberEmoji(value);
  }

  function applyAutocompleteSelection(item) {
    if (!item || !autocomplete) return;
    insertValueAtCursor(item.value, { start: autocomplete.start, end: autocomplete.end });
    setAutocomplete(null);
    setActiveSuggestionIndex(0);
    rememberEmoji(item.value);
  }

  function computeAutocomplete(nextText, cursorPos) {
    if (autocompleteDebounceRef.current) clearTimeout(autocompleteDebounceRef.current);
    autocompleteDebounceRef.current = setTimeout(() => {
      const match = getAutocompleteMatch(nextText, cursorPos);
      if (!match) {
        setAutocomplete(null);
        return;
      }

      const q = match.query;
      const baseSuggestions = emojiIndex
        .filter((entry) => {
          if (!q) return true;
          if (entry.id.includes(q)) return true;
          if (entry.name.toLowerCase().includes(q)) return true;
          return entry.keywords.some((keyword) => String(keyword).toLowerCase().includes(q));
        })
        .slice(0, MAX_SUGGESTIONS)
        .map((entry) => ({
          key: `native-${entry.id}`,
          label: `:${entry.id}:`,
          value: entry.native,
          preview: entry.native
        }));

      const customSuggestions = (customEmojis || [])
        .filter((entry) => String(entry?.name || "").includes(q))
        .slice(0, MAX_SUGGESTIONS)
        .map((entry) => ({
          key: `custom-${entry.id}`,
          label: `:${entry.name}:`,
          value: `:${entry.name}:`,
          previewSrc: entry.skins?.[0]?.src || ""
        }));

      const suggestions = [...customSuggestions, ...baseSuggestions].slice(0, MAX_SUGGESTIONS);
      if (!suggestions.length) {
        setAutocomplete(null);
        return;
      }

      const input = textareaRef.current;
      const composer = composerRef.current;
      let position = { top: 4, left: 8 };
      if (input && composer) {
        const caret = getCaretCoordinates(input, match.end);
        position = {
          left: Math.max(8, Math.min(caret.x, composer.clientWidth - 250)),
          top: Math.max(4, Math.min(caret.y - 168, composer.clientHeight - 180))
        };
      }

      setActiveSuggestionIndex(0);
      setAutocomplete({
        start: match.start,
        end: match.end,
        suggestions,
        position
      });
    }, 120);
  }

  function handleTextChange(e) {
    const nextValue = e.target.value;
    setText(nextValue);
    cacheSelection();
    computeAutocomplete(nextValue, e.target.selectionStart || 0);

    if (editTarget?.messageId) return;
    onTyping(true);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => onTyping(false), 1200);
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) {
      setPendingUpload(file);
      e.target.value = "";
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) setPendingUpload(file);
  }

  const pickerTheme = document.documentElement.classList.contains("theme-dark") ? "dark" : "light";
  const activeSuggestion = useMemo(
    () => (autocomplete ? autocomplete.suggestions[activeSuggestionIndex] : null),
    [autocomplete, activeSuggestionIndex]
  );

  return (
    <form
      ref={composerRef}
      className={`message-composer ${vanishMode ? "vanish-mode" : ""} ${dragActive ? "drag-active" : ""}`}
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {replyTarget && (
        <div className="replying-banner">
          <div className="replying-content">
            <div className="replying-title">Replying to {replyTarget.senderName || "message"}</div>
            <div className="replying-text">{replyTarget.preview || "Message"}</div>
          </div>
          <button type="button" className="replying-close" onClick={onCancelReply}>
            {"\u2715"}
          </button>
        </div>
      )}

      {editTarget?.messageId && (
        <div className="replying-banner editing-banner">
          <div className="replying-content">
            <div className="replying-title">Editing message</div>
            <div className="replying-text">{editTarget.text || "Message"}</div>
          </div>
          <button type="button" className="replying-close" onClick={onCancelEdit}>
            {"\u2715"}
          </button>
        </div>
      )}

      {pendingFile && (
        <div className="upload-preview">
          {previewUrl ? (
            <img src={previewUrl} alt="Preview" className="upload-preview-image" />
          ) : (
            <div className="upload-preview-file">{pendingFile.name}</div>
          )}
          <div className="upload-preview-actions">
            <button type="button" className="btn-secondary" onClick={clearPendingFile}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={sendPendingFile}>
              Send
            </button>
          </div>
        </div>
      )}

      <EmojiPickerPanel
        isOpen={showEmojis}
        onClose={() => setShowEmojis(false)}
        onSelectEmoji={applySelectedEmoji}
        theme={pickerTheme}
        customEmojis={customEmojis}
        recentEmojis={recentEmojis}
      />

      {autocomplete && (
        <div
          className="emoji-autocomplete"
          style={{ left: autocomplete.position.left, top: autocomplete.position.top }}
          role="listbox"
          aria-label="Emoji suggestions"
        >
          {autocomplete.suggestions.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              role="option"
              aria-selected={index === activeSuggestionIndex}
              className={`emoji-autocomplete-item ${index === activeSuggestionIndex ? "active" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applyAutocompleteSelection(entry);
              }}
            >
              <span className="emoji-autocomplete-preview">
                {entry.previewSrc ? <img src={entry.previewSrc} alt={entry.label} className="emoji-custom-preview" /> : entry.preview}
              </span>
              <span className="emoji-autocomplete-label">{entry.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="composer-actions">
        <button
          type="button"
          className="action-button"
          onClick={() => setShowEmojis((prev) => !prev)}
          title="Emoji"
          disabled={Boolean(editTarget?.messageId)}
          aria-label="Open emoji picker"
        >
          {"\uD83D\uDE0A"}
        </button>

        <label className="action-button" title="Attach image">
          {"\uD83D\uDDBC\uFE0F"}
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: "none" }}
            disabled={Boolean(editTarget?.messageId)}
          />
        </label>

        <label className="action-button" title="Attach file">
          {"\uD83D\uDCCE"}
          <input
            type="file"
            onChange={handleFileSelect}
            style={{ display: "none" }}
            disabled={Boolean(editTarget?.messageId)}
          />
        </label>
      </div>

      <textarea
        ref={textareaRef}
        className={`message-input message-input-area ${vanishMode ? "vanish-input" : ""}`}
        placeholder={editTarget?.messageId ? "Edit message..." : vanishMode ? "Disappearing message..." : "Type a message..."}
        value={text}
        rows={1}
        onChange={handleTextChange}
        onBlur={() => onTyping(false)}
        onClick={cacheSelection}
        onKeyUp={cacheSelection}
        onSelect={cacheSelection}
        onKeyDown={(e) => {
          if (autocomplete?.suggestions?.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveSuggestionIndex((prev) => (prev + 1) % autocomplete.suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveSuggestionIndex((prev) => (prev - 1 + autocomplete.suggestions.length) % autocomplete.suggestions.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && activeSuggestion) {
              e.preventDefault();
              applyAutocompleteSelection(activeSuggestion);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setAutocomplete(null);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            handleSubmit(e);
          }
        }}
      />

      <button type="submit" className="send-button" title={editTarget?.messageId ? "Save edit" : "Send message"}>
        {editTarget?.messageId ? "\u2714" : "\u21AA\uFE0F"}
      </button>
    </form>
  );
}


