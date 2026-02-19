(function () {
  const roomInput = document.getElementById("roomId");
  const joinBtn = document.getElementById("joinBtn");
  const leaveBtn = document.getElementById("leaveBtn");
  const micBtn = document.getElementById("micBtn");
  const cameraBtn = document.getElementById("cameraBtn");
  const statusBox = document.getElementById("status");
  const localVideo = document.getElementById("local");
  const remoteVideo = document.getElementById("remote");

  const config = window.APP_CONFIG || {};
  const SIGNALING_URL = String(config.SIGNALING_URL || "http://localhost:4000").replace(/\/+$/, "");

  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (config.TURN_URL) {
    iceServers.push({
      urls: config.TURN_URL,
      username: config.TURN_USERNAME || "",
      credential: config.TURN_CREDENTIAL || ""
    });
  }

  const state = {
    socket: null,
    pc: null,
    localStream: null,
    remoteStream: null,
    joined: false,
    roomId: "",
    isInitiator: false,
    remoteSocketId: "",
    makingOffer: false,
    restarting: false
  };

  function log(message, details) {
    const stamp = new Date().toLocaleTimeString();
    const detailText = details ? ` ${JSON.stringify(details)}` : "";
    const line = `[${stamp}] ${message}${detailText}`;
    statusBox.value += `${line}\n`;
    statusBox.scrollTop = statusBox.scrollHeight;
    console.log(line);
  }

  function setButtons() {
    const hasLocalStream = Boolean(state.localStream);
    joinBtn.disabled = state.joined;
    leaveBtn.disabled = !state.joined;
    micBtn.disabled = !hasLocalStream;
    cameraBtn.disabled = !hasLocalStream;
    micBtn.textContent = getMicLabel();
    cameraBtn.textContent = getCameraLabel();
  }

  function getMicLabel() {
    const audioTracks = state.localStream ? state.localStream.getAudioTracks() : [];
    const enabled = audioTracks.some((track) => track.enabled);
    return enabled ? "Toggle Mic (Mute)" : "Toggle Mic (Unmute)";
  }

  function getCameraLabel() {
    const videoTracks = state.localStream ? state.localStream.getVideoTracks() : [];
    const enabled = videoTracks.some((track) => track.enabled);
    return enabled ? "Toggle Camera (Off)" : "Toggle Camera (On)";
  }

  function waitForSocketIo() {
    if (window.io) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to load socket.io client script from signaling server"));
      };
      const cleanup = () => {
        window.removeEventListener("socketio-loaded", onLoaded);
        window.removeEventListener("socketio-error", onError);
      };
      window.addEventListener("socketio-loaded", onLoaded, { once: true });
      window.addEventListener("socketio-error", onError, { once: true });
    });
  }

  async function ensureSocketConnected() {
    await waitForSocketIo();
    if (state.socket) {
      if (state.socket.connected) return;
      await waitForConnect(state.socket);
      return;
    }

    state.socket = window.io(SIGNALING_URL, {
      transports: ["websocket", "polling"],
      reconnection: true
    });

    state.socket.on("connect", async () => {
      log("socket connected", { socketId: state.socket.id });
      if (state.joined && state.roomId) {
        log("reconnected: rejoining room", { roomId: state.roomId });
        try {
          const result = await emitJoinRoom(state.roomId);
          state.isInitiator = Boolean(result.isInitiator);
          if (Array.isArray(result.peers) && result.peers[0]) {
            state.remoteSocketId = result.peers[0];
          }
          if (state.isInitiator && state.remoteSocketId) {
            await createAndSendOffer({ iceRestart: true });
          }
        } catch (err) {
          log("rejoin failed", { error: err.message });
        }
      }
    });

    state.socket.on("disconnect", (reason) => {
      log("socket disconnected", { reason });
    });

    state.socket.on("room-full", ({ roomId }) => {
      log("room full", { roomId });
    });

    state.socket.on("room-joined", (payload) => {
      log("room joined", payload);
      if (payload && Array.isArray(payload.peers) && payload.peers[0]) {
        state.remoteSocketId = payload.peers[0];
      }
    });

    state.socket.on("peer-joined", async ({ socketId }) => {
      state.remoteSocketId = socketId;
      log("peer joined", { socketId, isInitiator: state.isInitiator });
      if (state.isInitiator) {
        try {
          await createAndSendOffer({ iceRestart: false });
        } catch (err) {
          log("offer failed after peer-joined", { error: err.message });
          await restartPeerConnection("offer creation failed");
        }
      }
    });

    state.socket.on("peer-left", ({ socketId, reason }) => {
      log("peer left", { socketId, reason });
      if (state.remoteSocketId === socketId) {
        state.remoteSocketId = "";
      }
      clearRemoteVideo();
    });

    state.socket.on("signal", async ({ from, data }) => {
      log("signal received", { from, type: data?.type });
      await handleSignalMessage(from, data);
    });

    await waitForConnect(state.socket);
  }

  function waitForConnect(socket) {
    if (socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("socket connection timeout"));
      }, 10000);
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error("socket connect error"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("connect_error", onError);
      };
      socket.on("connect", onConnect);
      socket.on("connect_error", onError);
    });
  }

  function emitJoinRoom(roomId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("join-room timeout")), 10000);
      state.socket.emit("join-room", { roomId }, (response) => {
        clearTimeout(timeout);
        if (response && response.ok === false) {
          reject(new Error(response.error || "join-room failed"));
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function createLocalStream() {
    if (state.localStream) return state.localStream;
    log("requesting media", { audio: true, video: true });
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = state.localStream;
    return state.localStream;
  }

  async function createPeerConnection() {
    cleanupPeerConnection();

    const pc = new RTCPeerConnection({ iceServers });
    state.pc = pc;
    state.remoteStream = new MediaStream();
    remoteVideo.srcObject = state.remoteStream;

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        state.remoteStream = event.streams[0];
        remoteVideo.srcObject = state.remoteStream;
        return;
      }
      state.remoteStream.addTrack(event.track);
      remoteVideo.srcObject = state.remoteStream;
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || !state.joined || !state.socket) return;
      state.socket.emit("signal", {
        roomId: state.roomId,
        to: state.remoteSocketId || undefined,
        data: {
          type: "ice",
          candidate: event.candidate
        }
      });
      log("ice candidate sent");
    };

    pc.onconnectionstatechange = async () => {
      log("pc connection state", { state: pc.connectionState });
      if (pc.connectionState === "failed") {
        await restartPeerConnection("pc connection failed");
      }
    };

    pc.oniceconnectionstatechange = () => {
      log("pc ice state", { state: pc.iceConnectionState });
    };

    const stream = await createLocalStream();
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
    log("peer connection ready", { iceServers: iceServers.map((entry) => entry.urls) });
  }

  function cleanupPeerConnection() {
    if (!state.pc) return;
    try {
      state.pc.ontrack = null;
      state.pc.onicecandidate = null;
      state.pc.onconnectionstatechange = null;
      state.pc.oniceconnectionstatechange = null;
      state.pc.close();
    } catch {}
    state.pc = null;
    clearRemoteVideo();
  }

  function clearRemoteVideo() {
    if (state.remoteStream) {
      state.remoteStream.getTracks().forEach((track) => track.stop());
      state.remoteStream = null;
    }
    remoteVideo.srcObject = null;
  }

  function stopLocalMedia() {
    if (!state.localStream) return;
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
    localVideo.srcObject = null;
  }

  async function createAndSendOffer({ iceRestart }) {
    if (!state.pc || !state.socket || !state.joined) return;
    state.makingOffer = true;
    try {
      const offer = await state.pc.createOffer({ iceRestart: Boolean(iceRestart) });
      await state.pc.setLocalDescription(offer);
      state.socket.emit("signal", {
        roomId: state.roomId,
        to: state.remoteSocketId || undefined,
        data: {
          type: "offer",
          sdp: state.pc.localDescription
        }
      });
      log("offer sent", { to: state.remoteSocketId || "room", iceRestart: Boolean(iceRestart) });
    } finally {
      state.makingOffer = false;
    }
  }

  async function handleSignalMessage(from, data) {
    if (!data || !data.type || !state.joined) return;
    state.remoteSocketId = from || state.remoteSocketId;

    if (!state.pc) {
      await createPeerConnection();
    }

    if (data.type === "offer") {
      try {
        const offerCollision = state.makingOffer || state.pc.signalingState !== "stable";
        if (offerCollision) {
          log("offer collision: rolling back local description");
          try {
            await state.pc.setLocalDescription({ type: "rollback" });
          } catch (err) {
            log("rollback failed", { error: err.message });
          }
        }

        await state.pc.setRemoteDescription(data.sdp);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        state.socket.emit("signal", {
          roomId: state.roomId,
          to: from,
          data: {
            type: "answer",
            sdp: state.pc.localDescription
          }
        });
        log("answer sent", { to: from });
      } catch (err) {
        log("offer handling failed", { error: err.message });
        await restartPeerConnection("offer handling failed");
      }
      return;
    }

    if (data.type === "answer") {
      try {
        await state.pc.setRemoteDescription(data.sdp);
        log("answer applied");
      } catch (err) {
        log("answer handling failed", { error: err.message });
      }
      return;
    }

    if (data.type === "ice") {
      try {
        if (data.candidate) {
          await state.pc.addIceCandidate(data.candidate);
          log("ice candidate applied");
        }
      } catch (err) {
        log("ice candidate failed", { error: err.message });
      }
    }
  }

  async function restartPeerConnection(reason) {
    if (state.restarting || !state.joined) return;
    state.restarting = true;
    log("restarting peer connection", { reason });
    try {
      await createPeerConnection();
      if (state.isInitiator && state.remoteSocketId) {
        await createAndSendOffer({ iceRestart: true });
      }
    } catch (err) {
      log("restart failed", { error: err.message });
    } finally {
      state.restarting = false;
    }
  }

  async function joinRoom() {
    const roomId = String(roomInput.value || "").trim();
    if (!roomId) {
      log("roomId is required");
      return;
    }
    if (state.joined) {
      log("already joined a room", { roomId: state.roomId });
      return;
    }

    try {
      // Clean leftovers if previous session did not close cleanly.
      cleanupPeerConnection();
      stopLocalMedia();

      await ensureSocketConnected();
      await createPeerConnection();

      const result = await emitJoinRoom(roomId);
      state.joined = true;
      state.roomId = roomId;
      state.isInitiator = Boolean(result.isInitiator);
      state.remoteSocketId = Array.isArray(result.peers) && result.peers[0] ? result.peers[0] : "";
      log("join success", { roomId, isInitiator: state.isInitiator });
    } catch (err) {
      log("join failed", { error: err.message });
      cleanupPeerConnection();
      stopLocalMedia();
    } finally {
      setButtons();
    }
  }

  function leaveRoom({ notifyServer = true } = {}) {
    if (notifyServer && state.socket && state.joined) {
      state.socket.emit("leave-room", { roomId: state.roomId });
    }

    cleanupPeerConnection();
    stopLocalMedia();

    state.joined = false;
    state.roomId = "";
    state.isInitiator = false;
    state.remoteSocketId = "";

    log("left room");
    setButtons();
  }

  function toggleMic() {
    if (!state.localStream) return;
    const tracks = state.localStream.getAudioTracks();
    if (tracks.length === 0) return;
    const nextEnabled = !tracks.some((track) => track.enabled);
    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });
    log("mic toggled", { enabled: nextEnabled });
    setButtons();
  }

  function toggleCamera() {
    if (!state.localStream) return;
    const tracks = state.localStream.getVideoTracks();
    if (tracks.length === 0) return;
    const nextEnabled = !tracks.some((track) => track.enabled);
    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });
    log("camera toggled", { enabled: nextEnabled });
    setButtons();
  }

  joinBtn.addEventListener("click", () => {
    joinRoom().catch((err) => log("join click failed", { error: err.message }));
  });
  leaveBtn.addEventListener("click", () => leaveRoom({ notifyServer: true }));
  micBtn.addEventListener("click", toggleMic);
  cameraBtn.addEventListener("click", toggleCamera);

  window.addEventListener("beforeunload", () => {
    leaveRoom({ notifyServer: true });
  });

  setButtons();
  log("client ready", { signalingUrl: SIGNALING_URL });
})();
