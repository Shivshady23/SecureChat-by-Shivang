// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useRef } from "react";
import { getAvatarSrc } from "../utils/avatar.js";

function CallVideo({ stream, muted = false, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;
  }, [stream]);

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function CallAudio({ stream }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;
    if (stream) {
      const playback = ref.current.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {});
      }
    }
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline />;
}

export default function CallOverlay({
  callState,
  localStream,
  remoteStream,
  peerUser,
  isMicMuted,
  isCameraOff,
  isRemoteSpeaking,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onToggleCamera
}) {
  const visible = !["idle"].includes(callState.status);
  if (!visible) return null;

  const isIncoming = callState.status === "incoming";
  const isVoice = callState.mode === "voice";
  const peerAvatar = getAvatarSrc(peerUser?.avatarUrl || "");
  const peerInitial = peerUser?.name?.[0]?.toUpperCase() || "?";

  return (
    <div className="call-overlay-backdrop">
      {!isIncoming && isVoice && remoteStream ? <CallAudio stream={remoteStream} /> : null}

      {isIncoming ? (
        <div className="call-incoming-modal">
          <h3>Incoming {isVoice ? "Voice" : "Video"} Call</h3>
          <p>{peerUser?.name || "Unknown user"} is calling...</p>
          <div className="call-incoming-actions">
            <button type="button" className="btn-secondary" onClick={onReject}>
              Reject
            </button>
            <button type="button" className="btn-primary" onClick={onAccept}>
              Accept
            </button>
          </div>
        </div>
      ) : (
        <div className="call-active-panel">
          <div className="call-topbar">
            <div className="call-title">
              {isVoice ? "Voice Call" : "Video Call"} with {peerUser?.name || "Unknown"}
            </div>
            <div className={`call-status-pill ${callState.status}`}>{callState.status}</div>
          </div>

          <div className={`call-media-grid ${isVoice ? "voice" : "video"}`}>
            {isVoice ? (
              <div className="call-voice-peer">
                <div className="call-voice-avatar">
                  {peerAvatar ? (
                    <img src={peerAvatar} alt={peerUser?.name || "User"} className="avatar-image" />
                  ) : (
                    peerInitial
                  )}
                </div>
                <div className={`call-speaking-indicator ${isRemoteSpeaking ? "active" : ""}`}>
                  {isRemoteSpeaking ? "Speaking" : "Listening"}
                </div>
              </div>
            ) : (
              <>
                <div className="call-remote-video-wrap">
                  {remoteStream ? (
                    <CallVideo stream={remoteStream} className="call-remote-video" />
                  ) : (
                    <div className="call-video-placeholder">Waiting for remote video...</div>
                  )}
                </div>
                <div className="call-local-video-wrap">
                  {localStream && !isCameraOff ? (
                    <CallVideo stream={localStream} muted className="call-local-video" />
                  ) : (
                    <div className="call-video-placeholder">Camera Off</div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="call-controls">
            <button type="button" className="btn-secondary" onClick={onToggleMute}>
              {isMicMuted ? "Unmute Mic" : "Mute Mic"}
            </button>
            {!isVoice && (
              <button type="button" className="btn-secondary" onClick={onToggleCamera}>
                {isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
              </button>
            )}
            <button type="button" className="btn-primary confirm-danger" onClick={() => onEnd({ reason: "ended", emit: true })}>
              End Call
            </button>
          </div>

          {callState.error ? <div className="error call-error">{callState.error}</div> : null}
        </div>
      )}
    </div>
  );
}
