// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiForm } from "../services/api.js";
import { clearAuth, getToken, getUser, setUser } from "../services/storage.js";
import { getAvatarSrc } from "../utils/avatar.js";

function toStoredUser(rawUser, fallback = {}) {
  return {
    id: rawUser?._id || rawUser?.id || fallback.id || "",
    name: rawUser?.name || fallback.name || "",
    username: rawUser?.username || fallback.username || "",
    publicKeyJwk: rawUser?.publicKeyJwk ?? fallback.publicKeyJwk ?? null,
    e2eePublicKeySpkiB64: rawUser?.e2eePublicKeySpkiB64 ?? fallback.e2eePublicKeySpkiB64 ?? "",
    e2eeKeyVersion: rawUser?.e2eeKeyVersion ?? fallback.e2eeKeyVersion ?? 1,
    about: rawUser?.about || "",
    avatarUrl: rawUser?.avatarUrl || ""
  };
}

export default function EditProfile() {
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);
  const [profile, setProfileState] = useState(() => getUser());
  const [aboutDraft, setAboutDraft] = useState(() => getUser()?.about || "");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      if (!getToken()) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        const res = await api("/api/users/me");
        if (cancelled || !res?.user) return;
        const next = toStoredUser(res.user, getUser() || {});
        setUser(next);
        setProfileState(next);
        setAboutDraft(next.about || "");
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load profile");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function applyUpdatedUser(rawUser) {
    setProfileState((prev) => {
      const next = toStoredUser(rawUser, prev || {});
      setUser(next);
      setAboutDraft(next.about || "");
      return next;
    });
  }

  async function saveStatus(event) {
    event.preventDefault();
    setSavingStatus(true);
    setError("");
    setNotice("");
    try {
      const res = await api("/api/users/me/about", {
        method: "PATCH",
        body: JSON.stringify({ about: String(aboutDraft || "") })
      });
      if (res?.user) {
        applyUpdatedUser(res.user);
        setNotice("Status updated.");
      }
    } catch (err) {
      setError(err.message || "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  }

  function openAvatarPicker() {
    avatarInputRef.current?.click();
  }

  async function handleAvatarSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    setUploadingAvatar(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file, file.name || "avatar");
      const uploaded = await apiForm("/api/upload", form);
      const res = await api("/api/users/me/avatar", {
        method: "PATCH",
        body: JSON.stringify({ avatarUrl: uploaded?.url || "" })
      });
      if (res?.user) {
        applyUpdatedUser(res.user);
        setNotice("Profile photo updated.");
      }
    } catch (err) {
      setError(err.message || "Failed to update profile photo");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    setUploadingAvatar(true);
    setError("");
    setNotice("");
    try {
      const res = await api("/api/users/me/avatar", {
        method: "PATCH",
        body: JSON.stringify({ avatarUrl: "" })
      });
      if (res?.user) {
        applyUpdatedUser(res.user);
        setNotice("Profile photo removed.");
      }
    } catch (err) {
      setError(err.message || "Failed to remove profile photo");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    setError("");
    try {
      await api("/api/users/me", { method: "DELETE" });
      clearAuth();
      navigate("/register", { replace: true });
    } catch (err) {
      setError(err.message || "Failed to delete account");
      setDeletingAccount(false);
      setShowDeleteConfirm(false);
    }
  }

  const avatarSrc = getAvatarSrc(profile?.avatarUrl);

  return (
    <div className="profile-page">
      <div className="profile-page-background" />
      <div className="profile-page-card">
        <div className="profile-page-top">
          <button type="button" className="btn-secondary profile-back-btn" onClick={() => navigate("/chat")}>
            {"\u2190"} Back to Chat
          </button>
          <h1>Edit Profile</h1>
          <p>Update your photo and status.</p>
        </div>

        {error ? <div className="error">{error}</div> : null}
        {notice ? <div className="profile-notice">{notice}</div> : null}

        <div className="profile-page-body">
          <div className="profile-page-avatar-row">
            <div className="profile-page-avatar">
              {avatarSrc ? (
                <img src={avatarSrc} alt={profile?.name || "Profile"} className="avatar-image" />
              ) : (
                profile?.name?.[0]?.toUpperCase() || "?"
              )}
            </div>
            <div className="profile-page-avatar-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={openAvatarPicker}
                disabled={uploadingAvatar || loading}
              >
                {uploadingAvatar ? "Uploading..." : "Change photo"}
              </button>
              {profile?.avatarUrl && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={removeAvatar}
                  disabled={uploadingAvatar || loading}
                >
                  Remove photo
                </button>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="profile-photo-input"
                onChange={handleAvatarSelected}
              />
            </div>
          </div>

          <div className="profile-readonly-grid">
            <div className="form-group">
              <label>Name</label>
              <input type="text" className="form-input" value={profile?.name || ""} disabled />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input type="text" className="form-input" value={`@${profile?.username || ""}`} disabled />
            </div>
          </div>

          <form className="form-group" onSubmit={saveStatus}>
            <label htmlFor="about">Custom status</label>
            <textarea
              id="about"
              className="form-input profile-status-input"
              value={aboutDraft}
              onChange={(event) => setAboutDraft(event.target.value.slice(0, 120))}
              maxLength={120}
              rows={3}
              placeholder="What's on your mind?"
              disabled={savingStatus || loading}
            />
            <div className="profile-form-footer">
              <span className="profile-char-count">{aboutDraft.length}/120</span>
              <button type="submit" className="btn-primary" disabled={savingStatus || loading}>
                {savingStatus ? "Saving..." : "Save status"}
              </button>
            </div>
          </form>

          <div className="profile-danger-zone">
            <h2>Danger Zone</h2>
            <p>Deleting your account permanently removes your chats and data.</p>
            <button
              type="button"
              className="btn-primary confirm-danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={loading}
            >
              Delete account
            </button>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => !deletingAccount && setShowDeleteConfirm(false)}>
          <div className="modal-content confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete Account</h2>
              <button
                className="modal-close"
                onClick={() => !deletingAccount && setShowDeleteConfirm(false)}
                disabled={deletingAccount}
              >
                {"\u2716"}
              </button>
            </div>
            <div className="modal-body">
              <p>This cannot be undone. Delete your account now?</p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingAccount}
              >
                Cancel
              </button>
              <button
                className="btn-primary confirm-danger"
                onClick={deleteAccount}
                disabled={deletingAccount}
              >
                {deletingAccount ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

