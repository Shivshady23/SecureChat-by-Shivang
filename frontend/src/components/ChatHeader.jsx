// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { getAvatarSrc } from "../utils/avatar.js";

export default function ChatHeader({
  chat,
  currentUserId,
  online,
  onShowInfo,
  onToggleVanish,
  onStartVoiceCall,
  onStartVideoCall,
  callDisabled = false,
  showBackButton = false,
  onBackToList
}) {
  const otherMember =
    chat.type === "direct"
      ? chat.members.find((m) => String(m._id) !== String(currentUserId))
      : null;
  const isGroup = chat.type === "group";

  const isOnline = chat.type === "direct" && otherMember && online.includes(otherMember._id);
  const title = chat.type === "group" ? chat.name : otherMember?.name || "Unknown";
  const avatarSrc = getAvatarSrc(isGroup ? chat?.avatarUrl || "" : otherMember?.avatarUrl || "");
  const statusText = isGroup
    ? chat?.motive?.trim() || "No motive set"
    : otherMember?.about?.trim() || "No status set";
  const subtitle =
    chat.type === "group"
      ? `${chat.members.length} members`
      : isOnline
      ? "Active now"
      : "Offline";
  const modeLabel = chat.vanishMode ? "Vanish mode on" : "Normal mode";

  return (
    <div className="chat-header">
      <div className={`chat-header-info ${chat.type === "direct" ? "profile-hover-anchor" : ""}`}>
        {showBackButton && (
          <button
            type="button"
            className="chat-back-btn"
            onClick={onBackToList}
            title="Show sidebar"
          >
            {"\u2192"}
          </button>
        )}
        <div className="chat-header-avatar">
          {avatarSrc ? (
            <img src={avatarSrc} alt={title} className="avatar-image" />
          ) : (
            title[0]?.toUpperCase() || "?"
          )}
        </div>
        <div className="chat-header-details">
          <div className="chat-header-title">{title}</div>
          <div className={`chat-header-subtitle ${isOnline ? "online" : ""}`}>
            {subtitle} {"\u2022"} {modeLabel}
          </div>
        </div>
        {chat.type === "direct" && otherMember && (
          <div className="profile-hover-card">
            <div className="profile-hover-top">
              <div className="profile-hover-avatar">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={otherMember?.name || "User"} className="avatar-image" />
                ) : (
                  otherMember?.name?.[0]?.toUpperCase() || "?"
                )}
              </div>
              <div className="profile-hover-main">
                <div className="profile-hover-name">{otherMember?.name || "Unknown"}</div>
                <div className="profile-hover-username">@{otherMember?.username || "unknown"}</div>
              </div>
              <div className={`profile-hover-presence ${isOnline ? "online" : ""}`}>
                {isOnline ? "Online" : "Offline"}
              </div>
            </div>
            <div className="profile-hover-status">{statusText}</div>
          </div>
        )}
      </div>

      <div className="chat-header-actions">
        {chat.type === "direct" && (
          <>
            <button
              className="header-action-btn"
              onClick={onStartVoiceCall}
              title="Start voice call"
              disabled={callDisabled}
            >
              {"\u260E"}
            </button>
            <button
              className="header-action-btn"
              onClick={onStartVideoCall}
              title="Start video call"
              disabled={callDisabled}
            >
              {"\uD83C\uDFA5"}
            </button>
          </>
        )}
        <button
          className={`header-action-btn vanish-toggle ${chat.vanishMode ? "active" : ""}`}
          onClick={() => onToggleVanish(!chat.vanishMode)}
          title={chat.vanishMode ? "Switch to normal mode" : "Switch to vanish mode"}
        >
          {"\u23F3"}
        </button>
        <button className="header-action-btn" onClick={onShowInfo} title="Chat info">{"\u2139\uFE0F"}</button>
      </div>
    </div>
  );
}

