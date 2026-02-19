// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useMemo, useRef, useState } from "react";
import { getAvatarSrc } from "../utils/avatar.js";

export default function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  online,
  currentUserId,
  onQuickCreateGroup,
  activeFilter = "unlocked",
  onOpenLockedChats,
  onOpenUnlockedChats,
  onArchiveSelectedChat
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!showMenu) return;

    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setShowMenu(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMenu]);

  useEffect(() => {
    setShowMenu(false);
  }, [selectedChatId]);

  const chatRows = useMemo(() => {
    return (chats || []).map((chat) => {
      const otherMember =
        chat.type === "direct"
          ? chat.members.find((m) => String(m._id) !== String(currentUserId))
          : null;
      const label = chat.type === "group" ? chat.name : otherMember?.name || "Unknown";
      const isOnline = Boolean(otherMember && online.includes(otherMember._id));
      const groupAvatarSrc = chat.type === "group" ? getAvatarSrc(chat?.avatarUrl || "") : "";
      const avatarSrc = groupAvatarSrc || getAvatarSrc(otherMember?.avatarUrl || "");
      const avatarText =
        chat.type === "group"
          ? (chat?.name || "?")?.[0]?.toUpperCase() || "?"
          : otherMember?.name?.[0]?.toUpperCase() || "?";
      const unreadCount = Number(chat.unreadCount || 0);
      const hasUnread = Number.isFinite(unreadCount) && unreadCount > 0;
      const isPinned = Boolean(chat.pinnedMessageId);
      const motive = chat.type === "group" ? String(chat?.motive || "").trim() : "";

      return {
        chat,
        label,
        isOnline,
        avatarSrc,
        avatarText,
        unreadCount,
        hasUnread,
        isPinned,
        motive
      };
    });
  }, [chats, currentUserId, online]);

  const formatChatTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";

    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return isToday
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredChats = chatRows.filter((row) => row.label.toLowerCase().includes(normalizedSearch));

  return (
    <div className="chat-list-container modern">
      <div className="chat-list-header modern">
        <div className="chat-list-title-row">
          <h2>{activeFilter === "locked" ? "Locked Chats" : "Chats"}</h2>
          <div className="chat-list-top-actions">
            {activeFilter !== "locked" && (
              <button
                type="button"
                className="chat-header-icon-btn chat-header-create-btn"
                onClick={() => onQuickCreateGroup?.()}
                title="Create Group"
              >
                <span className="chat-create-icon" aria-hidden="true">+</span>
                <span className="chat-create-label">Create Group</span>
              </button>
            )}
            <div className="chat-list-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="chat-header-icon-btn"
                onClick={() => setShowMenu((prev) => !prev)}
                title="More options"
                aria-haspopup="menu"
                aria-expanded={showMenu}
              >
                {"\u22EE"}
              </button>
              {showMenu && (
                <div className="chat-list-menu" role="menu" aria-label="Chat actions">
                  <button
                    type="button"
                    className="chat-list-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenLockedChats?.();
                    }}
                    disabled={activeFilter === "locked"}
                  >
                    Locked Chats
                  </button>
                  <button
                    type="button"
                    className="chat-list-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onOpenUnlockedChats?.();
                    }}
                    disabled={activeFilter === "unlocked"}
                  >
                    All Chats
                  </button>
                  <button
                    type="button"
                    className="chat-list-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      onArchiveSelectedChat?.();
                    }}
                    disabled={!selectedChatId}
                  >
                    Archive Chat
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="chat-search modern">
        <span className="search-prefix">{"\u2315"}</span>
        <input
          type="text"
          placeholder={activeFilter === "locked" ? "Search locked chats" : "Search or start a new chat"}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input modern"
        />
      </div>

      <div className="chat-list modern">
        {filteredChats.length === 0 ? (
          <div className="empty-state">
            <p>No chats found</p>
            <p className="muted-text">Try another filter or search text.</p>
          </div>
        ) : (
          filteredChats.map((row) => {
            const chatTime = formatChatTime(row.chat.lastMessageAt || row.chat.updatedAt);
            return (
              <button
                key={row.chat._id}
                className={`chat-item ${row.hasUnread ? "has-unread" : ""} ${String(selectedChatId) === String(row.chat._id) ? "active" : ""}`}
                onClick={() => onSelectChat(row.chat._id)}
              >
                <div className="chat-avatar">
                  {row.avatarSrc ? (
                    <img src={row.avatarSrc} alt={row.label} className="avatar-image" />
                  ) : (
                    row.avatarText
                  )}
                </div>

                <div className="chat-info">
                  <div className="chat-name-row">
                    <div className={`chat-name ${row.hasUnread ? "chat-name-unread" : ""}`}>{row.label}</div>
                    <div
                      className={`chat-time ${row.hasUnread ? "chat-time-unread" : ""}`}
                      title={row.chat.lastMessageAt || row.chat.updatedAt ? new Date(row.chat.lastMessageAt || row.chat.updatedAt).toLocaleString() : ""}
                    >
                      {chatTime}
                    </div>
                  </div>

                  <div className={`chat-preview ${row.hasUnread ? "chat-preview-unread" : ""}`}>
                    {row.chat.type === "group"
                      ? row.motive
                        ? `${row.chat.members.length} members \u2022 ${row.motive}`
                        : `${row.chat.members.length} members`
                      : row.isOnline
                      ? "Active now"
                      : "Tap to open chat"}
                  </div>
                </div>

                <div className="chat-right-meta">
                  {activeFilter === "locked" && <span className="chat-lock-pill">{"\uD83D\uDD12"}</span>}
                  {row.isPinned && <span className="chat-pin">{"\uD83D\uDCCC"}</span>}
                  {row.hasUnread && <span className="chat-unread-pill">{row.unreadCount > 99 ? "99+" : row.unreadCount}</span>}
                  {row.isOnline && row.chat.type === "direct" && <div className="online-indicator" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}


