// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useState } from "react";
import { getAvatarSrc } from "../utils/avatar.js";

export default function UsersList({
  users,
  requests,
  chats,
  onSendRequest,
  currentUserId
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="users-list-container">
      <div className="users-list-header">
        <h3>Contacts</h3>
      </div>

      <div className="users-search">
        <input
          type="text"
          placeholder="Search contacts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="users-list">
        {filteredUsers.length === 0 ? (
          <div className="empty-state">
            <p>No contacts found</p>
          </div>
        ) : (
          filteredUsers.map((u) => {
            const outgoing = requests.outgoing.find(
              (r) => r.to?._id === u._id || r.to === u._id
            );
            const hasChat = chats.some(
              (c) => c.type === "direct" && c.members.some((m) => String(m._id) === String(u._id))
            );
            const avatarSrc = getAvatarSrc(u.avatarUrl);

            return (
              <div key={u._id} className="user-item">
                <div className="user-avatar">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt={u.name} className="avatar-image" />
                  ) : (
                    u.name[0]?.toUpperCase() || "?"
                  )}
                </div>
                <div className="user-info">
                  <div className="user-name">{u.name}</div>
                  <div className="user-username">@{u.username}</div>
                </div>
                {hasChat ? (
                  <span className="user-status">Connected</span>
                ) : outgoing?.status === "pending" ? (
                  <span className="user-status pending">Pending</span>
                ) : (
                  <button
                    className="user-action-btn"
                    onClick={() => onSendRequest(u._id)}
                  >
                    Message
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

