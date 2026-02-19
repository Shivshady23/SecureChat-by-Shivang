// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TURN_CREDENTIAL, TURN_URL, TURN_USERNAME } from "../services/runtimeConfig.js";

const CALL_TIMEOUT_MS = 30000;

function buildRtcConfig() {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (TURN_URL) {
    iceServers.push({
      urls: TURN_URL,
      username: TURN_USERNAME || "",
      credential: TURN_CREDENTIAL || ""
    });
  }
  return { iceServers };
}

const RTC_CONFIG = buildRtcConfig();

const INITIAL_STATE = {
  status: "idle",
  mode: "voice",
  callId: "",
  chatId: "",
  roomId: "",
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

function makeRoomId(chatId) {
  return `call:${String(chatId || "").trim()}`;
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
  const pendingIceRef = useRef([]);
  const isInitiatorRef = useRef(false);
  const isRestartingRef = useRef(false);
  const audioMonitorRef = useRef({ rafId: 0, ctx: null, analyser: null, source: null });

  const isBusy = !["idle", "ended"].includes(callState.status);
  const myUserId = String(currentUserId || "");

  const log = useCallback((label, details = null) => {
    if (details) console.info("[call]", label, details);
    else console.info("[call]", label);
  }, []);

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

  const updateCallState = useCallback((next) => {
    setCallState((prev) => {
      const merged = { ...prev, ...next };
      callStateRef.current = merged;
      return merged;
    });
  }, []);

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
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
      } catch {}
    }
    pcRef.current = null;
    pendingIceRef.current = [];
    setRemoteStream(null);
    stopSpeakingMonitor();
  }, [stopSpeakingMonitor]);

  const emitLeaveRoom = useCallback(
    (roomId) => {
      const normalized = String(roomId || "").trim();
      if (!socket || !normalized) return;
      socket.emit("leave-room", { roomId: normalized });
    },
    [socket]
  );

  const hardReset = useCallback(
    ({ leaveRoom = true } = {}) => {
      const currentRoomId = String(callStateRef.current.roomId || "").trim();
      clearCallTimeout();
      if (leaveRoom) {
        emitLeaveRoom(currentRoomId);
      }
      closePeerConnection();
      stopLocalStream();
      isInitiatorRef.current = false;
      updateCallState({ ...INITIAL_STATE, status: "idle" });
    },
    [clearCallTimeout, closePeerConnection, emitLeaveRoom, stopLocalStream, updateCallState]
  );

  const createPeerConnection = useCallback(
    ({ roomId }) => {
      closePeerConnection();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      pendingIceRef.current = [];

      pc.ontrack = (event) => {
        const [stream] = event.streams || [];
        if (!stream) return;
        setRemoteStream(stream);
        startSpeakingMonitor(stream);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || !socket) return;
        const current = callStateRef.current;
        socket.emit("signal", {
          roomId,
          to: current.peerSocketId || undefined,
          data: {
            type: "ice",
            candidate: event.candidate
          }
        });
        log("sent signal:ice", { roomId, to: current.peerSocketId || "broadcast" });
      };

      pc.onconnectionstatechange = () => {
        const state = String(pc.connectionState || "");
        log("pc connection state", { state });
        if (state === "failed") {
          updateCallState({ error: "Connection failed. Retrying..." });
          setTimeout(() => {
            const current = callStateRef.current;
            if (!["calling", "accepted"].includes(current.status)) return;
            if (!isRestartingRef.current) {
              isRestartingRef.current = true;
              pc
                .createOffer({
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: current.mode === "video",
                  iceRestart: true
                })
                .then((offer) => pc.setLocalDescription(offer).then(() => offer))
                .then((offer) => {
                  if (!socket) return;
                  socket.emit("signal", {
                    roomId,
                    to: current.peerSocketId || undefined,
                    data: {
                      type: "offer",
                      sdp: offer
                    }
                  });
                })
                .catch((err) => log("restart offer failed", { message: err?.message || "unknown" }))
                .finally(() => {
                  isRestartingRef.current = false;
                });
            }
          }, 300);
        }
      };

      return pc;
    },
    [closePeerConnection, log, socket, startSpeakingMonitor, updateCallState]
  );

  const getMediaStream = useCallback(async (mode) => {
    const constraints = mode === "video" ? { audio: true, video: true } : { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const flushPendingIceCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIceRef.current.splice(0);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        log("failed to apply queued ice", { message: err?.message || "unknown" });
      }
    }
  }, [log]);

  const joinCallRoom = useCallback(
    (roomId) =>
      new Promise((resolve, reject) => {
        if (!socket) {
          reject(new Error("Socket not connected"));
          return;
        }
        const normalized = String(roomId || "").trim();
        if (!normalized) {
          reject(new Error("Invalid room ID"));
          return;
        }
        socket.emit("join-room", { roomId: normalized }, (response) => {
          if (!response || response.ok === false) {
            reject(new Error(response?.error || "Failed to join room"));
            return;
          }
          resolve(response);
        });
      }),
    [socket]
  );

  const createAndSendOffer = useCallback(
    async ({ iceRestart = false } = {}) => {
      const current = callStateRef.current;
      const roomId = String(current.roomId || "").trim();
      const pc = pcRef.current;
      if (!socket || !pc || !roomId) return;

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: current.mode === "video",
        iceRestart: Boolean(iceRestart)
      });
      await pc.setLocalDescription(offer);

      socket.emit("signal", {
        roomId,
        to: current.peerSocketId || undefined,
        data: {
          type: "offer",
          sdp: offer
        }
      });
      log("sent signal:offer", {
        roomId,
        to: current.peerSocketId || "broadcast",
        iceRestart: Boolean(iceRestart)
      });
    },
    [log, socket]
  );

  const endCall = useCallback(
    ({ reason = "ended", emit = true } = {}) => {
      const current = callStateRef.current;
      const roomId = String(current.roomId || "").trim();
      if (emit && socket && roomId) {
        socket.emit("end-call", {
          roomId,
          toUserId: current.peerUserId || "",
          reason
        });
      }

      hardReset({ leaveRoom: true });
      updateCallState({ ...INITIAL_STATE, status: "ended", error: "" });
      setTimeout(() => {
        if (callStateRef.current.status === "ended") {
          updateCallState({ ...INITIAL_STATE, status: "idle" });
        }
      }, 800);
    },
    [hardReset, socket, updateCallState]
  );

  const startCall = useCallback(
    async (mode) => {
      if (!socket) return;
      const peerUserId = String(selectedPeerUserId || "");
      const chatId = String(selectedChatId || "");
      const roomId = makeRoomId(chatId);

      if (!peerUserId || !chatId) {
        updateCallState({ error: "Select a direct chat to start call." });
        return;
      }
      if (isBusy) {
        updateCallState({ error: "Already in another call." });
        return;
      }

      try {
        hardReset({ leaveRoom: true });

        updateCallState({
          ...INITIAL_STATE,
          status: "calling",
          mode,
          callId: roomId,
          roomId,
          chatId,
          peerUserId,
          startedAt: Date.now(),
          error: ""
        });

        const stream = await getMediaStream(mode);
        const pc = createPeerConnection({ roomId });
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const joinResponse = await joinCallRoom(roomId);
        isInitiatorRef.current = Boolean(joinResponse?.isInitiator);
        const peerSocketId = String(joinResponse?.peers?.[0] || "");

        updateCallState({
          peerSocketId,
          status: "calling",
          roomId
        });

        socket.emit("call-invite", {
          roomId,
          chatId,
          toUserId: peerUserId,
          callType: mode
        });
        log("call invite sent", { roomId, toUserId: peerUserId, isInitiator: isInitiatorRef.current });

        if (peerSocketId && isInitiatorRef.current) {
          await createAndSendOffer({ iceRestart: false });
        }

        clearCallTimeout();
        timeoutRef.current = setTimeout(() => {
          const current = callStateRef.current;
          if (current.status === "calling") {
            endCall({ reason: "timeout", emit: true });
            updateCallState({
              ...INITIAL_STATE,
              status: "ended",
              error: "Call timed out."
            });
          }
        }, CALL_TIMEOUT_MS);
      } catch (err) {
        log("start call failed", { message: err?.message || "unknown" });
        hardReset({ leaveRoom: true });
        updateCallState({
          ...INITIAL_STATE,
          status: "ended",
          error: permissionErrorMessage(err)
        });
        setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 800);
      }
    },
    [
      clearCallTimeout,
      createAndSendOffer,
      createPeerConnection,
      endCall,
      getMediaStream,
      hardReset,
      isBusy,
      joinCallRoom,
      log,
      selectedChatId,
      selectedPeerUserId,
      socket,
      updateCallState
    ]
  );

  const acceptIncomingCall = useCallback(async () => {
    const current = callStateRef.current;
    if (!socket || current.status !== "incoming") return;

    try {
      updateCallState({ status: "accepted", error: "", acceptedAt: Date.now() });
      const stream = await getMediaStream(current.mode);
      const pc = createPeerConnection({ roomId: current.roomId });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const joinResponse = await joinCallRoom(current.roomId);
      isInitiatorRef.current = Boolean(joinResponse?.isInitiator);
      const peerSocketId = String(joinResponse?.peers?.[0] || current.peerSocketId || "");
      updateCallState({
        status: "accepted",
        peerSocketId,
        acceptedAt: Date.now()
      });

      socket.emit("call-accepted", {
        roomId: current.roomId,
        toUserId: current.peerUserId
      });
      log("incoming call accepted", { roomId: current.roomId, isInitiator: isInitiatorRef.current });

      if (peerSocketId && isInitiatorRef.current) {
        await createAndSendOffer({ iceRestart: false });
      }
    } catch (err) {
      log("accept call failed", { message: err?.message || "unknown" });
      socket.emit("call-rejected", {
        roomId: current.roomId,
        toUserId: current.peerUserId,
        reason: "media-error"
      });
      hardReset({ leaveRoom: true });
      updateCallState({
        ...INITIAL_STATE,
        status: "ended",
        error: permissionErrorMessage(err)
      });
      setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 800);
    }
  }, [createAndSendOffer, createPeerConnection, getMediaStream, hardReset, joinCallRoom, log, socket, updateCallState]);

  const rejectIncomingCall = useCallback(() => {
    const current = callStateRef.current;
    if (socket && current.roomId && current.peerUserId) {
      socket.emit("call-rejected", {
        roomId: current.roomId,
        toUserId: current.peerUserId,
        reason: "rejected"
      });
    }
    hardReset({ leaveRoom: true });
    updateCallState({ ...INITIAL_STATE, status: "idle" });
  }, [hardReset, socket, updateCallState]);

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

    const onRoomFull = ({ roomId }) => {
      if (String(callStateRef.current.roomId || "") !== String(roomId || "")) return;
      hardReset({ leaveRoom: false });
      updateCallState({
        ...INITIAL_STATE,
        status: "ended",
        error: "Call room is full."
      });
      setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 800);
    };

    const onCalling = ({ roomId, toUserId, toSocketId, callType }) => {
      updateCallState({
        roomId: String(roomId || ""),
        peerUserId: String(toUserId || callStateRef.current.peerUserId || ""),
        peerSocketId: String(toSocketId || ""),
        mode: callType === "video" ? "video" : callStateRef.current.mode,
        status: "calling"
      });
    };

    const onIncomingCall = ({ roomId, chatId, fromUserId, fromSocketId, callType }) => {
      const current = callStateRef.current;
      if (!["idle", "ended"].includes(current.status)) {
        socket.emit("call-rejected", {
          roomId,
          toUserId: fromUserId,
          reason: "busy"
        });
        return;
      }
      updateCallState({
        ...INITIAL_STATE,
        status: "incoming",
        callId: String(roomId || ""),
        roomId: String(roomId || ""),
        chatId: String(chatId || ""),
        peerUserId: String(fromUserId || ""),
        peerSocketId: String(fromSocketId || ""),
        mode: callType === "video" ? "video" : "voice",
        startedAt: Date.now()
      });
      log("incoming call", { roomId, fromUserId, toUserId: myUserId });
    };

    const onCallAccepted = async ({ roomId, byUserId, bySocketId }) => {
      const current = callStateRef.current;
      if (String(current.roomId) !== String(roomId || "")) return;
      clearCallTimeout();
      updateCallState({
        status: "accepted",
        peerUserId: String(byUserId || current.peerUserId || ""),
        peerSocketId: String(bySocketId || current.peerSocketId || ""),
        acceptedAt: Date.now()
      });
      if (pcRef.current && isInitiatorRef.current) {
        await createAndSendOffer({ iceRestart: false }).catch((err) =>
          log("offer after accept failed", { message: err?.message || "unknown" })
        );
      }
    };

    const onPeerJoined = async ({ roomId, socketId, userId }) => {
      const current = callStateRef.current;
      if (String(current.roomId) !== String(roomId || "")) return;
      updateCallState({
        peerSocketId: String(socketId || current.peerSocketId || ""),
        peerUserId: String(userId || current.peerUserId || "")
      });
      log("peer joined", { roomId, socketId });
      if (isInitiatorRef.current && pcRef.current) {
        await createAndSendOffer({ iceRestart: false }).catch((err) =>
          log("offer on peer-joined failed", { message: err?.message || "unknown" })
        );
      }
    };

    const onSignal = async ({ roomId, from, fromUserId, data }) => {
      const current = callStateRef.current;
      if (String(current.roomId) !== String(roomId || "")) return;
      const type = String(data?.type || "");
      if (!["offer", "answer", "ice"].includes(type)) return;
      if (!pcRef.current) {
        log("signal ignored - no peer connection", { type });
        return;
      }

      updateCallState({
        peerSocketId: String(from || current.peerSocketId || ""),
        peerUserId: String(fromUserId || current.peerUserId || "")
      });
      log("received signal", { type, from });

      try {
        if (type === "offer") {
          const offerSdp = data?.sdp;
          if (!offerSdp) return;
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(offerSdp));
          await flushPendingIceCandidates();
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socket.emit("signal", {
            roomId: current.roomId,
            to: from,
            data: {
              type: "answer",
              sdp: answer
            }
          });
          updateCallState({ status: "accepted", acceptedAt: Date.now() });
          return;
        }

        if (type === "answer") {
          const answerSdp = data?.sdp;
          if (!answerSdp) return;
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answerSdp));
          await flushPendingIceCandidates();
          clearCallTimeout();
          updateCallState({ status: "accepted", acceptedAt: Date.now() });
          return;
        }

        if (type === "ice") {
          const candidate = data?.candidate;
          if (!candidate) return;
          if (!pcRef.current.remoteDescription) {
            pendingIceRef.current.push(candidate);
            return;
          }
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        log("signal handling failed", { type, message: err?.message || "unknown" });
      }
    };

    const onPeerLeft = ({ roomId }) => {
      if (String(callStateRef.current.roomId) !== String(roomId || "")) return;
      endCall({ reason: "peer-left", emit: false });
    };

    const onCallRejected = ({ roomId, reason }) => {
      if (String(callStateRef.current.roomId) !== String(roomId || "")) return;
      hardReset({ leaveRoom: true });
      updateCallState({
        ...INITIAL_STATE,
        status: "ended",
        error: reason === "offline" ? "User is offline." : "Call rejected."
      });
      setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 800);
    };

    const onBusy = ({ userId }) => {
      if (String(callStateRef.current.peerUserId || "") !== String(userId || "")) return;
      hardReset({ leaveRoom: true });
      updateCallState({ ...INITIAL_STATE, status: "ended", error: "User is busy." });
      setTimeout(() => updateCallState({ ...INITIAL_STATE, status: "idle" }), 800);
    };

    const onEndCall = ({ roomId }) => {
      if (roomId && String(callStateRef.current.roomId || "") !== String(roomId || "")) return;
      endCall({ reason: "ended", emit: false });
    };

    const onCallError = ({ message }) => {
      updateCallState({ error: String(message || "Call error") });
    };

    const onSocketConnect = async () => {
      const current = callStateRef.current;
      if (!current.roomId || !["calling", "accepted"].includes(current.status)) return;
      try {
        const joined = await joinCallRoom(current.roomId);
        isInitiatorRef.current = Boolean(joined?.isInitiator);
        updateCallState({
          peerSocketId: String(joined?.peers?.[0] || current.peerSocketId || "")
        });
        if (isInitiatorRef.current && joined?.peers?.[0] && pcRef.current) {
          await createAndSendOffer({ iceRestart: true });
        }
      } catch (err) {
        log("rejoin failed", { message: err?.message || "unknown" });
      }
    };

    socket.on("room-full", onRoomFull);
    socket.on("calling", onCalling);
    socket.on("incoming-call", onIncomingCall);
    socket.on("call-accepted", onCallAccepted);
    socket.on("peer-joined", onPeerJoined);
    socket.on("signal", onSignal);
    socket.on("peer-left", onPeerLeft);
    socket.on("call-rejected", onCallRejected);
    socket.on("busy", onBusy);
    socket.on("end-call", onEndCall);
    socket.on("call-error", onCallError);
    socket.on("connect", onSocketConnect);

    return () => {
      socket.off("room-full", onRoomFull);
      socket.off("calling", onCalling);
      socket.off("incoming-call", onIncomingCall);
      socket.off("call-accepted", onCallAccepted);
      socket.off("peer-joined", onPeerJoined);
      socket.off("signal", onSignal);
      socket.off("peer-left", onPeerLeft);
      socket.off("call-rejected", onCallRejected);
      socket.off("busy", onBusy);
      socket.off("end-call", onEndCall);
      socket.off("call-error", onCallError);
      socket.off("connect", onSocketConnect);
    };
  }, [
    clearCallTimeout,
    createAndSendOffer,
    endCall,
    flushPendingIceCandidates,
    hardReset,
    joinCallRoom,
    log,
    myUserId,
    socket,
    updateCallState
  ]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    return () => {
      hardReset({ leaveRoom: true });
    };
  }, [hardReset]);

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
