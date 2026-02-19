// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

const EmojiMartPicker = lazy(() => import("@emoji-mart/react"));

export default function EmojiPickerPanel({
  isOpen,
  onClose,
  onSelectEmoji,
  theme = "light",
  customEmojis = [],
  recentEmojis = []
}) {
  const rootRef = useRef(null);
  const [emojiData, setEmojiData] = useState(null);

  useEffect(() => {
    if (!isOpen || emojiData) return;
    let cancelled = false;
    import("@emoji-mart/data")
      .then((module) => {
        if (!cancelled) {
          setEmojiData(module?.default || module);
        }
      })
      .catch(() => {
        if (!cancelled) setEmojiData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, emojiData]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        onClose?.();
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const fallbackRecent = useMemo(
    () =>
      (recentEmojis || []).map((native) => ({
        id: String(native),
        name: String(native),
        native: String(native)
      })),
    [recentEmojis]
  );

  if (!isOpen) return null;

  return (
    <div className="emoji-picker-sheet-wrap" ref={rootRef}>
      <div className="emoji-picker-sheet" role="dialog" aria-label="Emoji picker" aria-modal="false">
        {emojiData ? (
          <Suspense fallback={<div className="emoji-picker-loading">Loading emojis...</div>}>
            <EmojiMartPicker
              data={emojiData}
              onEmojiSelect={(emojiDataValue) => onSelectEmoji?.(emojiDataValue)}
              autoFocus
              navPosition="top"
              previewPosition="none"
              searchPosition="sticky"
              skinTonePosition="search"
              perLine={9}
              set="native"
              maxFrequentRows={2}
              emojiSize={22}
              theme={theme === "dark" ? "dark" : "light"}
              custom={customEmojis}
              categoryIcons={{
                custom: { src: customEmojis?.[0]?.skins?.[0]?.src || "" }
              }}
              categories={[
                "frequent",
                "people",
                "nature",
                "foods",
                "activity",
                "places",
                "objects",
                "symbols",
                "flags",
                ...(customEmojis?.length ? ["custom"] : [])
              ]}
              frequentlyUsed={fallbackRecent}
            />
          </Suspense>
        ) : (
          <div className="emoji-picker-loading">Loading emojis...</div>
        )}
      </div>
    </div>
  );
}

