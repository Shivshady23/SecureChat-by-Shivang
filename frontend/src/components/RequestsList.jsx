// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { getAvatarSrc } from "../utils/avatar.js";

export default function RequestsList({
  requests,
  onRespondRequest
}) {
  const incomingCount = requests.incoming?.filter((r) => r.status === "pending").length || 0;

  if (incomingCount === 0) {
    return null;
  }

  return (
    <div className="requests-container">
      <div className="requests-header">
        <h3>Chat Requests ({incomingCount})</h3>
      </div>

      <div className="requests-list">
        {requests.incoming.map((req) => {
          const avatarSrc = getAvatarSrc(req.from?.avatarUrl);
          return (
            <div key={req._id} className="request-item">
              <div className="request-avatar">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={req.from?.name || "User"} className="avatar-image" />
                ) : (
                  req.from?.name?.[0]?.toUpperCase() || "?"
                )}
              </div>
              <div className="request-info">
                <div className="request-name">{req.from?.name || "Unknown"}</div>
                <div className="request-username">@{req.from?.username || "user"}</div>
              </div>
              {req.status === "pending" ? (
                <div className="request-actions">
                  <button
                    className="request-accept"
                    onClick={() => onRespondRequest(req._id, "accepted")}
                  >
                    {"\u2713"}
                  </button>
                  <button
                    className="request-reject"
                    onClick={() => onRespondRequest(req._id, "rejected")}
                  >
                    {"\u2716"}
                  </button>
                </div>
              ) : (
                <span className="request-status">{req.status}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

