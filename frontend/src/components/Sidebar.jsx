// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ChatList from "./ChatList";
import UsersList from "./UsersList";
import RequestsList from "./RequestsList";
import CreateGroupModal from "./CreateGroupModal";
import { getAvatarSrc } from "../utils/avatar.js";

export default function Sidebar({
  user,
  chats,
  selectedChatId,
  requests,
  users,
  online,
  onSelectChat,
  onSendRequest,
  onRespondRequest,
  onCreateGroup,
  onLogout,
  activeChatFilter,
  onOpenLockedChats,
  onOpenUnlockedChats,
  onArchiveSelectedChat,
  onStartVoiceCall,
  onStartVideoCall,
  notificationSettings,
  onUpdateNotificationSetting,
  onRequestDesktopPermission,
  error,
  sidebarStyle
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("chats");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [callsSearch, setCallsSearch] = useState("");
  const [theme, setThemeLocal] = useState(() => {
    try {
      return localStorage.getItem("sc_theme") || "light";
    } catch {
      return "light";
    }
  });

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem("sc_theme", next);
    window.dispatchEvent(new Event("themechange"));
    setThemeLocal(next);
  }

  function openProfileEditor() {
    navigate("/profile/edit");
  }

  const pendingIncoming = (requests?.incoming || []).filter((r) => r.status === "pending").length;
  const unreadChatCount = (chats || []).filter((chat) => Number(chat?.unreadCount || 0) > 0).length;
  const avatarSrc = getAvatarSrc(user?.avatarUrl);
  const callRows = useMemo(() => {
    const normalizedSearch = callsSearch.trim().toLowerCase();
    const rows = (chats || [])
      .filter((chat) => chat?.type === "direct")
      .map((chat) => {
        const other = (chat.members || []).find((m) => String(m?._id || m) !== String(user?.id)) || null;
        const label = other?.name || "Unknown";
        const username = other?.username || "unknown";
        const avatar = getAvatarSrc(other?.avatarUrl || "");
        const chatId = String(chat?._id || "");
        return { chatId, label, username, avatar, other };
      });

    if (!normalizedSearch) return rows;
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(normalizedSearch) ||
        row.username.toLowerCase().includes(normalizedSearch)
    );
  }, [callsSearch, chats, user?.id]);

  return (
    <aside className="sidebar sidebar-shell" style={sidebarStyle}>
      <div className="sidebar-rail" aria-label="Sidebar navigation">
        <button
          type="button"
          className={`rail-btn ${activeTab === "chats" ? "active" : ""}`}
          onClick={() => setActiveTab("chats")}
          title="Chats"
        >
          <span className="rail-icon">{"\u2630"}</span>
          {unreadChatCount > 0 && (
            <span className="rail-badge success">{unreadChatCount > 99 ? "99+" : unreadChatCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`rail-btn ${activeTab === "requests" ? "active" : ""}`}
          onClick={() => setActiveTab("requests")}
          title="Requests"
        >
          <span className="rail-icon">{"\uD83D\uDCE8"}</span>
          {pendingIncoming > 0 && (
            <span className="rail-badge danger">{pendingIncoming > 99 ? "99+" : pendingIncoming}</span>
          )}
        </button>

        <button
          type="button"
          className={`rail-btn ${activeTab === "contacts" ? "active" : ""}`}
          onClick={() => setActiveTab("contacts")}
          title="Contacts"
        >
          <span className="rail-icon">{"\uD83D\uDC65"}</span>
        </button>

        <button
          type="button"
          className={`rail-btn ${activeTab === "calls" ? "active" : ""}`}
          onClick={() => setActiveTab("calls")}
          title="Calls"
        >
          <span className="rail-icon">{"\u260E"}</span>
        </button>

        <button
          type="button"
          className="rail-btn"
          onClick={() => setShowNotificationSettings(true)}
          title="Notifications"
        >
          <span className="rail-icon">{"\uD83D\uDD14"}</span>
          <span className="rail-dot" />
        </button>

        <div className="rail-divider" />

        <button
          type="button"
          className="rail-btn"
          onClick={openProfileEditor}
          title="Edit profile"
        >
          <span className="rail-icon">{"\u2699"}</span>
        </button>

        <button type="button" className="rail-btn" onClick={toggleTheme} title="Toggle theme">
          <span className="rail-icon">{theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}</span>
        </button>

        <button type="button" className="rail-btn" onClick={onLogout} title="Logout">
          <span className="rail-icon">{"\u21AA"}</span>
        </button>

        <button type="button" className="rail-profile-btn" onClick={openProfileEditor} title="Profile">
          <span className="rail-profile-avatar">
            {avatarSrc ? (
              <img src={avatarSrc} alt={user?.name || "Profile"} className="avatar-image" />
            ) : (
              user?.name?.[0]?.toUpperCase() || "?"
            )}
          </span>
        </button>
      </div>

      <div className="sidebar-panel">
        {error ? <div className="error-banner">{error}</div> : null}

        {activeTab === "chats" && (
          <div className="sidebar-panel-scroll">
            <ChatList
              chats={chats}
              selectedChatId={selectedChatId}
              onSelectChat={onSelectChat}
              online={online}
              users={users}
              currentUserId={user?.id}
              onQuickCreateGroup={() => setShowCreateGroup(true)}
              activeFilter={activeChatFilter}
              onOpenLockedChats={onOpenLockedChats}
              onOpenUnlockedChats={onOpenUnlockedChats}
              onArchiveSelectedChat={onArchiveSelectedChat}
            />
          </div>
        )}

        {activeTab === "contacts" && (
          <div className="sidebar-panel-scroll">
            <UsersList
              users={users}
              requests={requests}
              chats={chats}
              onSendRequest={onSendRequest}
              currentUserId={user?.id}
            />
          </div>
        )}

        {activeTab === "requests" && (
          <div className="sidebar-panel-scroll sidebar-requests-view">
            <div className="panel-section-title">Requests</div>
            <RequestsList
              requests={requests}
              onRespondRequest={onRespondRequest}
            />
            {pendingIncoming === 0 && (
              <div className="empty-state">
                <p>No pending requests</p>
                <p className="muted-text">New requests will appear here.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "calls" && (
          <div className="sidebar-panel-scroll sidebar-calls-view">
            <div className="panel-section-title">Calls</div>
            <div className="calls-search">
              <input
                type="text"
                value={callsSearch}
                onChange={(e) => setCallsSearch(e.target.value)}
                className="search-input modern"
                placeholder="Search name or number"
              />
            </div>
            <div className="calls-list">
              {callRows.length === 0 ? (
                <div className="empty-state">
                  <p>No contacts found</p>
                  <p className="muted-text">Start a direct chat to place calls.</p>
                </div>
              ) : (
                callRows.map((row) => (
                  <div key={row.chatId} className="call-row">
                    <button
                      type="button"
                      className="call-contact-btn"
                      onClick={() => onSelectChat?.(row.chatId)}
                      title={`Open chat with ${row.label}`}
                    >
                      <span className="call-avatar">
                        {row.avatar ? (
                          <img src={row.avatar} alt={row.label} className="avatar-image" />
                        ) : (
                          row.label[0]?.toUpperCase() || "?"
                        )}
                      </span>
                      <span className="call-meta">
                        <span className="call-name">{row.label}</span>
                        <span className="call-username">@{row.username}</span>
                      </span>
                    </button>
                    <div className="call-actions">
                      <button
                        type="button"
                        className="call-action-btn"
                        onClick={() => onStartVideoCall?.(row.chatId)}
                        title="Start video call"
                      >
                        {"\uD83C\uDFA5"}
                      </button>
                      <button
                        type="button"
                        className="call-action-btn"
                        onClick={() => onStartVoiceCall?.(row.chatId)}
                        title="Start voice call"
                      >
                        {"\u260E"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {showCreateGroup && (
        <CreateGroupModal
          users={users}
          onClose={() => setShowCreateGroup(false)}
          onCreate={onCreateGroup}
        />
      )}

      {showNotificationSettings && (
        <div className="modal-overlay" onClick={() => setShowNotificationSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Notification Settings</h2>
              <button className="modal-close" onClick={() => setShowNotificationSettings(false)}>
                {"\u2716"}
              </button>
            </div>
            <div className="modal-body">
              <label className="setting-row">
                <span>Push notifications</span>
                <input
                  type="checkbox"
                  checked={Boolean(notificationSettings?.push)}
                  onChange={(e) => onUpdateNotificationSetting?.("push", e.target.checked)}
                />
              </label>
              <label className="setting-row">
                <span>Sound notification</span>
                <input
                  type="checkbox"
                  checked={Boolean(notificationSettings?.sound)}
                  onChange={(e) => onUpdateNotificationSetting?.("sound", e.target.checked)}
                />
              </label>
              <label className="setting-row">
                <span>Desktop notification</span>
                <input
                  type="checkbox"
                  checked={Boolean(notificationSettings?.desktop)}
                  onChange={(e) => onUpdateNotificationSetting?.("desktop", e.target.checked)}
                />
              </label>
              <label className="setting-row">
                <span>Only when chat is not active</span>
                <input
                  type="checkbox"
                  checked={Boolean(notificationSettings?.onlyWhenInactive)}
                  onChange={(e) => onUpdateNotificationSetting?.("onlyWhenInactive", e.target.checked)}
                />
              </label>

              <button className="btn-secondary desktop-perm-btn" onClick={onRequestDesktopPermission}>
                Allow Desktop Notifications
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setShowNotificationSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

