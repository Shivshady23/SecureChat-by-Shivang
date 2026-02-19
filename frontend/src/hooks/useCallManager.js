// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Optional TURN placeholder:
    // { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" }
  ]
};

const CALL_TIMEOUT_MS = 30000;

const INITIAL_STATE = {
  status: "idle",
  mode: "voice",
  callId: "",
  chatId: "",
  peerUserId: "",
  peerSocketId: "",
  incomingOffer: null,
  startedAt: 0,
  acceptedAt: 0,
  error: ""
};

function permissionErrorMessage(err) {
  const name = String(err?.name || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone/camera permission denied.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Required media device not found.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Microphone/camera is already in use.";
  }
  return err?.message || "Unable to access media devices.";
}

function createCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useCallManager({ socket, currentUserId, selectedChatId, selectedPeerUserId }) {
  const [callState, setCallState] = useState(INITIAL_STATE);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);

  const callStateRef = useRef(INITIAL_STATE);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const timeoutRef = useRef(null);
  const audioMonitorRef = useRef({ rafId: 0, ctx: null, analyser: null, source: null });

  const isBusy = !["idle", "ended"].includes(callState.status);

  const clearCallTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stopSpeakingMonitor = useCallback(() => {
    const current = audioMonitorRef.current;
    if (current.rafId) cancelAnimationFrame(current.rafId);
    if (current.source) current.source.disconnect();
    if (current.analyser) current.analyser.disconnect();
    if (current.ctx) current.ctx.close().catch(() => {});
    audioMonitorRef.current = { rafId: 0, ctx: null, analyser: null, source: null };
    setIsRemoteSpeaking(false);
  }, []);

  const startSpeakingMonitor = useCallback(
    (stream) => {
      stopSpeakingMonitor();
      if (!stream) return;
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        const bins = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(bins);
          let sum = 0;
          for (let i = 0; i < bins.length; i += 1) sum += bins[i];
          const avg = sum / Math.max(1, bins.length);
          setIsRemoteSpeaking(avg > 14);
          audioMonitorRef.current.rafId = requestAnimationFrame(tick);
        };

        audioMonitorRef.current = { rafId: requestAnimationFrame(tick), ctx, analyser, source };
      } catch {
        setIsRemoteSpeaking(false);
      }
    },
    [stopSpeakingMonitor]
  );

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    setLocalStream(null);
    setIsMicMuted(false);
    setIsCameraOff(false);
  }, []);

  const closePeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      try {
        pcRef.current.close();
      } catch {}
    }
    pcRef.current = null;
    setRemoteStream(null);
    stopSpeakingMonitor();
  }, [stopSpeakingMonitor]);

  const updateCallState = useCallback((next) => {
    setCallState((prev) => {
      const merged = { ...prev, ...next };
      callStateRef.current = merged;
      return merged;
    });
  }, []);

  const resetCall = useCallback(() => {
    clearCallTimeout();
    closePeerConnection();
    stopLocalStream();
    updateCallState({ ...INITIAL_STATE, status: "idle" });
  }, [clearCallTimeout, closePeerConnection, stopLocalStream, updateCallState]);

  const createPeerConnection = useCallback(
    ({ targetUserId, targetSocketId, callId }) => {
      closePeerConnection();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      pc.ontrack = (event) => {
        const [stream] = event.streams || [];
        if (!stream) return;
        setRemoteStream(stream);
        startSpeakingMonitor(stream);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || !socket) return;
        socket.emit("ice-candidate", {
          callId,
          toUserId: targetUserId,
          toSocketId: targetSocketId || "",
          candidate: event.candidate
        });
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (["failed", "disconnected", "closed"].includes(state)) {
          updateCallState({ status: "ended" });
        }
      };

      return pc;
    },
    [closePeerConnection, socket, startSpeakingMonitor, updateCallState]
  );

  const getMediaStream = useCallback(async (mode) => {
    const constraints = mode === "video" ? { audio: true, video: true } : { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const endCall = useCallback(
    ({ reason = "ended", emit = true } = {}) => {
      const { callId } = callStateRef.current;
      if (emit && socket && callId) {
        socket.emit("end-call", { callId, reason });
      }
      clearCallTimeout();
      closePeerConnection();
      stopLocalStream();
      updateCallState({ ...INITIAL_STATE, status: "ended" });
      setTimeout(() => {
        updateCallState({ ...INITIAL_STATE, status: "idle" });
      }, 800);
    },
    [clearCallTimeout, closePeerConnection, socket, stopLocalStream, updateCallState]
  );

  const startCall = useCallback(
    async (mode) => {
      if (!socket) return;
      const peerUserId = String(selectedPeerUserId || "");
      const chatId = String(selectedChatId || "");
      if (!peerUserId || !chatId) {
        updateCallState({ error: "Select a direct chat to start call." });
        return;
      }
      if (isBusy) {
        updateCallState({ error: "Already in another call." });
        return;
      }

      try {
        const callId = createCallId();
        updateCallState({
          ...INITIAL_STATE,
          status: "calling",
          mode,
          peerUserId,
          chatId,
          callId,
          startedAt: Date.now()
        });

        const stream = await getMediaStream(mode);
        const pc = createPeerConnection({ targetUserId: peerUserId, callId });
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: mode === "video"
        });
        await pc.setLocalDescription(offer);

        socket.emit("call-user", {
          callId,
          toUserId: peerUserId,
          chatId,
          callType: mode,
          offer,
          timeoutMs: CALL_TIMEOUT_MS
        });

        clearCallTimeout();
        timeoutRef.current = setTimeout(() => {
          const current = callStateRef.current;
          if (current.status === "calling") {
            endCall({ reason: "timeout", emit: true });
            updateCallState({ ...INITIAL_STATE, status: "ended", error: "Call timed out." });
          }
        }, CALL_TIMEOUT_MS);
      } catch (err) {
        endCall({ reason: "error", emit: false });
        updateCallState({
          ...INITIAL_STATE,
          status: "ended",
          error: permissionErrorMessage(err)
        });
      }
    },
    [
      clearCallTimeout,
      createPeerConnection,
      endCall,
      getMediaStream,
      isBusy,
      selectedChatId,
      selectedPeerUserId,
      socket,
      updateCallState
    ]
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!socket) return;
    const current = callStateRef.current;
    if (current.status !== "incoming" || !current.incomingOffer || !current.callId) return;

    try {
      updateCallState({ status: "accepted", error: "", acceptedAt: Date.now() });
      const stream = await getMediaStream(current.mode);
      const pc = createPeerConnection({
        targetUserId: current.peerUserId,
        targetSocketId: current.peerSocketId,
        callId: current.callId
      });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(current.incomingOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer-call", {
        callId: current.callId,
        answer
      });
    } catch (err) {
      socket.emit("call-rejected", {
        callId: current.callId,
        reason: "media-error"
      });
      endCall({ reason: "error", emit: false });
      updateCallState({
        ...INITIAL_STATE,
        status: "ended",
        error: permissionErrorMessage(err)
      });
    }
  }, [createPeerConnection, endCall, getMediaStream, socket, updateCallState]);

  const rejectIncomingCall = useCallback(() => {
    const { callId } = callStateRef.current;
    if (socket && callId) {
      socket.emit("call-rejected", { callId, reason: "rejected" });
    }
    endCall({ reason: "rejected", emit: false });
  }, [endCall, socket]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !isMicMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMicMuted(nextMuted);
  }, [isMicMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    if (!tracks.length) return;
    const nextOff = !isCameraOff;
    tracks.forEach((track) => {
      track.enabled = !nextOff;
    });
    setIsCameraOff(nextOff);
  }, [isCameraOff]);

  useEffect(() => {
    if (!socket) return undefined;

    const onCalling = ({ callId, toUserId, toSocketId, callType }) => {
      const current = callStateRef.current;
      updateCallState({
        ...current,
        callId: String(callId || ""),
        peerUserId: String(toUserId || current.peerUserId || ""),
        peerSocketId: String(toSocketId || ""),
        mode: callType === "video" ? "video" : current.mode
      });
    };

    const onIncomingCall = ({ callId, chatId, fromUserId, fromSocketId, callType, offer }) => {
      const current = callStateRef.current;
      if (!["idle", "ended"].includes(current.status)) {
        socket.emit("busy", { userId: String(currentUserId || "") });
        socket.emit("call-rejected", { callId, reason: "busy" });
        return;
      }
      updateCallState({
        ...INITIAL_STATE,
        status: "incoming",
        callId: String(callId || ""),
        chatId: String(chatId || ""),
        peerUserId: String(fromUserId || ""),
        peerSocketId: String(fromSocketId || ""),
        mode: callType === "video" ? "video" : "voice",
        incomingOffer: offer || null,
        startedAt: Date.now()
      });
    };

    const onAnswerCall = async ({ callId, answer }) => {
      const current = callStateRef.current;
      if (String(current.callId) !== String(callId) || !pcRef.current || !answer) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      clearCallTimeout();
      updateCallState({ status: "accepted", acceptedAt: Date.now() });
    };

    const onIceCandidate = async ({ callId, candidate }) => {
      const current = callStateRef.current;
      if (String(current.callId) !== String(callId) || !candidate || !pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    };

    const onCallRejected = ({ callId, reason }) => {
      if (String(callStateRef.current.callId) !== String(callId)) return;
      endCall({ reason: reason || "rejected", emit: false });
      updateCallState({
        ...INITIAL_STATE,
        status: "rejected",
        error: reason === "offline" ? "User is offline." : "Call rejected."
      });
      setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 900);
    };

    const onBusy = ({ userId }) => {
      if (String(callStateRef.current.peerUserId || "") !== String(userId || "")) return;
      endCall({ reason: "busy", emit: false });
      updateCallState({ ...INITIAL_STATE, status: "busy", error: "User is busy." });
      setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 900);
    };

    const onEndCall = ({ callId }) => {
      if (String(callStateRef.current.callId) !== String(callId)) return;
      endCall({ reason: "ended", emit: false });
    };

    const onCallError = ({ message }) => {
      updateCallState({ error: String(message || "Call error") });
    };

    socket.on("calling", onCalling);
    socket.on("incoming-call", onIncomingCall);
    socket.on("answer-call", onAnswerCall);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("call-rejected", onCallRejected);
    socket.on("busy", onBusy);
    socket.on("end-call", onEndCall);
    socket.on("call-error", onCallError);

    return () => {
      socket.off("calling", onCalling);
      socket.off("incoming-call", onIncomingCall);
      socket.off("answer-call", onAnswerCall);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("call-rejected", onCallRejected);
      socket.off("busy", onBusy);
      socket.off("end-call", onEndCall);
      socket.off("call-error", onCallError);
    };
  }, [clearCallTimeout, currentUserId, endCall, socket, updateCallState]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    return () => {
      resetCall();
    };
  }, [resetCall]);

  const controls = useMemo(
    () => ({
      startVoiceCall: () => startCall("voice"),
      startVideoCall: () => startCall("video"),
      acceptIncomingCall,
      rejectIncomingCall,
      endCall,
      toggleMute,
      toggleCamera
    }),
    [acceptIncomingCall, endCall, rejectIncomingCall, startCall, toggleCamera, toggleMute]
  );

  return {
    callState,
    localStream,
    remoteStream,
    isMicMuted,
    isCameraOff,
    isRemoteSpeaking,
    isBusy,
    ...controls
  };
}
