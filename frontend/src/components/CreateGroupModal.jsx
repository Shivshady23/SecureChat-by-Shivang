// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useState } from "react";

export default function CreateGroupModal({
  users,
  onClose,
  onCreate
}) {
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [formError, setFormError] = useState("");

  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function handleCreate() {
    if (!groupName.trim() || selectedMembers.length === 0) {
      setFormError("Please enter a group name and select at least one member");
      return;
    }
    setFormError("");
    onCreate(groupName, selectedMembers);
    setGroupName("");
    setSelectedMembers([]);
    onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Create Group Chat</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {formError && <div className="group-form-error">{formError}</div>}
          <div className="form-group">
            <label>Group Name</label>
            <input
              type="text"
              placeholder="Enter group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Select Members</label>
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
            />

            <div className="members-list">
              {filteredUsers.map((u) => (
                <label key={u._id} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(u._id)}
                    onChange={(e) =>
                      setSelectedMembers((prev) =>
                        e.target.checked
                          ? [...prev, u._id]
                          : prev.filter((id) => id !== u._id)
                      )
                    }
                  />
                  <span className="checkbox-avatar">{u.name[0]?.toUpperCase()}</span>
                  <span className="checkbox-label">
                    <div>{u.name}</div>
                    <div className="muted">@{u.username}</div>
                  </span>
                </label>
              ))}
            </div>

            {selectedMembers.length > 0 && (
              <div className="selected-count">
                {selectedMembers.length} member{selectedMembers.length > 1 ? "s" : ""} selected
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
}

