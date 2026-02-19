// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { memo } from "react";

const QUICK_REACTIONS = ["\u2764\uFE0F", "\uD83D\uDE02", "\uD83D\uDE2E", "\uD83D\uDE22", "\uD83D\uDE21", "\uD83D\uDC4D"];

function ReactionBar({ onReact, className = "", style = {} }) {
  return (
    <div className={`message-emoji-bar ${className}`.trim()} style={style} role="toolbar" aria-label="React to message">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="message-emoji-btn"
          onClick={() => onReact?.(emoji)}
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export default memo(ReactionBar);

