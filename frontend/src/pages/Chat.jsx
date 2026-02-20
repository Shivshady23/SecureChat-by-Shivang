// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, api, apiForm, apiUpload } from "../services/api.js";
import {
  clearAuth,
  getToken,
  getUser,
  setUser
} from "../services/storage.js";
import { connectSocket, disconnectSocket } from "../services/socket.js";
import {
  base64ToArrayBuffer,
  decryptBinaryForCurrentUser,
  decryptTextForCurrentUser,
  encryptForReceiver,
  ensureUserKeyPair
} from "../utils/crypto.js";
import { getAvatarSrc } from "../utils/avatar.js";
import Sidebar from "../components/Sidebar";
import ChatHeader from "../components/ChatHeader";
import MessageList from "../components/MessageList";
import MessageInput from "../components/MessageInput";
import CallOverlay from "../components/CallOverlay";
import { useCallManager } from "../hooks/useCallManager.js";

const MAX_EDIT_WINDOW_MS = 15 * 60 * 1000;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const UI_SILENT_REFRESH_MS = 10 * 1000;

export default function Chat() {
  // UI configuration and defaults used across the chat page.
  const SIDEBAR_WIDTH_KEY = "sc_sidebar_width";
  const defaultNotificationSettings = {
    push: true,
    sound: true,
    desktop: true,
    onlyWhenInactive: true
  };
  const user = getUser();
  const ARCHIVED_CHATS_KEY = `sc_archived_chats_${user?.id || "anon"}`;

  function clampSidebarWidth(nextWidth) {
    const minWidth = 280;
    const absoluteMaxWidth = 620;
    if (typeof window === "undefined") {
      return Math.min(Math.max(nextWidth, minWidth), absoluteMaxWidth);
    }
    const maxByViewport = Math.max(minWidth, window.innerWidth - 420);
    return Math.min(Math.max(nextWidth, minWidth), Math.min(absoluteMaxWidth, maxByViewport));
  }

  // Component state for chats, messages, notifications, and UI controls.
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [customEmojis, setCustomEmojis] = useState([]);
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState("");
  const [typingMap, setTypingMap] = useState({});
  const [online, setOnline] = useState([]);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState({});
  const [showInfo, setShowInfo] = useState(false);
  const [popup, setPopup] = useState(null);
  const [pushToasts, setPushToasts] = useState([]);
  const [notificationSettings, setNotificationSettings] = useState(() => {
    try {
      const raw = localStorage.getItem("sc_notifications");
      return raw ? { ...defaultNotificationSettings, ...JSON.parse(raw) } : defaultNotificationSettings;
    } catch {
      return defaultNotificationSettings;
    }
  });
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [replyToMessageId, setReplyToMessageId] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupMotiveDraft, setGroupMotiveDraft] = useState("");
  const [groupAvatarUrlDraft, setGroupAvatarUrlDraft] = useState("");
  const [groupAvatarFile, setGroupAvatarFile] = useState(null);
  const [groupAvatarPreviewUrl, setGroupAvatarPreviewUrl] = useState("");
  const [savingGroupProfile, setSavingGroupProfile] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState("");
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 960px)").matches;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(max-width: 960px)").matches;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 360;
    const parsed = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
    const initial = Number.isFinite(parsed) ? parsed : 360;
    return clampSidebarWidth(initial);
  });
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [chatFilter, setChatFilter] = useState("unlocked");
  const [archivedChatIds, setArchivedChatIds] = useState(() => {
    try {
      const raw = localStorage.getItem(`sc_archived_chats_${getUser()?.id || "anon"}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
    } catch {
      return [];
    }
  });
  const [lockedAccessDigest, setLockedAccessDigest] = useState("");
  const [chatLockPrompt, setChatLockPrompt] = useState(null);
  const [chatLockPassword, setChatLockPassword] = useState("");
  const [chatLockPromptError, setChatLockPromptError] = useState("");
  const [chatLockPromptBusy, setChatLockPromptBusy] = useState(false);
  const [socketInstance, setSocketInstance] = useState(null);
  const [pendingSidebarCall, setPendingSidebarCall] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [decryptedImageUrls, setDecryptedImageUrls] = useState({});

  // Mutable refs for sockets, cached state snapshots, and temporary timers.
  const socketRef = useRef(null);
  const e2eeInitAttempted = useRef(false);
  const selectedChatIdRef = useRef("");
  const usersRef = useRef([]);
  const chatsRef = useRef([]);
  const messagesRef = useRef([]);
  const notificationSettingsRef = useRef(defaultNotificationSettings);
  const sidebarResizeStartXRef = useRef(0);
  const sidebarResizeStartWidthRef = useRef(360);
  const groupAvatarInputRef = useRef(null);
  const decryptingImageRef = useRef(new Set());
  const decryptedImageUrlsRef = useRef({});
  const silentRefreshRunningRef = useRef(false);

  // Data normalization helpers.
  function normalizeUnreadCount(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  }

  function withChatUnread(chat, fallbackUnread = 0) {
    if (!chat) return chat;
    const hasUnread = Object.prototype.hasOwnProperty.call(chat, "unreadCount");
    return {
      ...chat,
      unreadCount: hasUnread ? normalizeUnreadCount(chat.unreadCount) : normalizeUnreadCount(fallbackUnread)
    };
  }

  async function toPasswordDigest(password) {
    const raw = String(password || "");
    if (!raw) return "";
    if (typeof window === "undefined" || !window.crypto?.subtle) {
      throw new Error("Secure context required for lock password");
    }
    const encoded = new TextEncoder().encode(raw);
    const digest = await window.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function openUnlockedChatById(chatId) {
    const normalized = String(chatId || "");
    if (!normalized) return;
    setSelectedChatId(normalized);
    setChats((prev) =>
      prev.map((chat) =>
        String(chat._id) === normalized
          ? { ...chat, unreadCount: 0 }
          : chat
      )
    );
    if (isMobileViewport) {
      setIsSidebarOpen(false);
    }
  }

  function openChatLockPrompt(prompt) {
    setChatLockPrompt(prompt);
    setChatLockPassword("");
    setChatLockPromptError("");
    setChatLockPromptBusy(false);
  }

  function closeChatLockPrompt() {
    if (chatLockPromptBusy) return;
    setChatLockPrompt(null);
    setChatLockPassword("");
    setChatLockPromptError("");
  }

  function promptUnlockLockedChat(chat, options = {}) {
    if (!chat || !chat.isLocked) return;
    openChatLockPrompt({
      mode: "unlock",
      chatId: String(chat._id),
      chatName: getChatTitle(chat),
      openAfterUnlock: Boolean(options.openAfterUnlock)
    });
  }

  function openChatById(chatId) {
    const normalized = String(chatId || "");
    if (!normalized) return;
    const targetChat = chatsRef.current.find((chat) => String(chat._id) === normalized);
    // In "Locked Chats" view, allow opening and using locked chats without unlocking.
    if (targetChat?.isLocked && chatFilter !== "locked") {
      promptUnlockLockedChat(targetChat, { openAfterUnlock: true });
      return;
    }
    openUnlockedChatById(normalized);
  }

  function showSidebarPanel() {
    if (isMobileViewport) {
      setIsSidebarOpen(true);
    }
  }

  function mergeChatUpdate(updatedChat) {
    if (!updatedChat?._id) return;
    const chatId = String(updatedChat._id);
    const stillMember = (updatedChat.members || []).some(
      (member) => String(member?._id || member) === String(user.id)
    );

    setChats((prev) => {
      if (!stillMember) {
        return prev.filter((chat) => String(chat._id) !== chatId);
      }

      let found = false;
      const next = prev.map((chat) => {
        if (String(chat._id) !== chatId) return chat;
        found = true;
        const hasIncomingUnread = Object.prototype.hasOwnProperty.call(updatedChat, "unreadCount");
        return {
          ...chat,
          ...updatedChat,
          unreadCount: hasIncomingUnread
            ? normalizeUnreadCount(updatedChat.unreadCount)
            : normalizeUnreadCount(chat.unreadCount)
        };
      });

      if (!found) {
        next.unshift(withChatUnread(updatedChat));
      }
      return next;
    });

    if (!stillMember && String(selectedChatIdRef.current) === chatId) {
      setSelectedChatId("");
      setMessages([]);
      setShowInfo(false);
      setSelectedMessageIds([]);
      setReplyToMessageId(null);
      setEditingMessageId("");
    }
  }

  function startSidebarResize(clientX) {
    if (isMobileViewport) return;
    sidebarResizeStartXRef.current = clientX;
    sidebarResizeStartWidthRef.current = sidebarWidth;
    setIsSidebarResizing(true);
  }

  function onSidebarResizerPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    startSidebarResize(event.clientX);
  }

  function onSidebarResizerKeyDown(event) {
    if (isMobileViewport) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarWidth((prev) => clampSidebarWidth(prev - 20));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth((prev) => clampSidebarWidth(prev + 20));
    }
  }

  function sortMessagesByDate(items) {
    return [...items].sort((a, b) => {
      const left = new Date(a?.createdAt || 0).getTime();
      const right = new Date(b?.createdAt || 0).getTime();
      return left - right;
    });
  }

  function appendUniqueMessage(prev, nextMessage) {
    if (!nextMessage?._id) return prev;
    return prev.some((m) => String(m._id) === String(nextMessage._id)) ? prev : sortMessagesByDate([...prev, nextMessage]);
  }

  function replaceMessageById(prev, messageId, nextMessage) {
    const normalizedId = String(messageId || "");
    if (!normalizedId || !nextMessage?._id) return prev;
    const next = prev.filter((msg) => String(msg._id) !== normalizedId);
    if (!next.some((msg) => String(msg._id) === String(nextMessage._id))) {
      next.push(nextMessage);
    }
    return sortMessagesByDate(next);
  }

  function mergeMessages(prev, incomingMessages) {
    const byId = new Map();
    for (const msg of prev) {
      byId.set(String(msg._id), msg);
    }
    for (const msg of incomingMessages) {
      byId.set(String(msg._id), msg);
    }
    return sortMessagesByDate(Array.from(byId.values()));
  }

  function toStoredUser(rawUser) {
    return {
      id: rawUser?._id || rawUser?.id,
      name: rawUser?.name || "",
      username: rawUser?.username || "",
      publicKeyJwk: rawUser?.publicKeyJwk || null,
      e2eePublicKeySpkiB64: rawUser?.e2eePublicKeySpkiB64 || "",
      e2eeKeyVersion: rawUser?.e2eeKeyVersion || 1,
      about: rawUser?.about || "",
      avatarUrl: rawUser?.avatarUrl || ""
    };
  }

  function syncCurrentUserProfile(nextUser) {
    setUser(nextUser);
    setUsers((prev) =>
      prev.map((entry) =>
        String(entry?._id || entry?.id) === String(nextUser.id)
          ? { ...entry, about: nextUser.about, avatarUrl: nextUser.avatarUrl }
          : entry
      )
    );
    setChats((prev) =>
      prev.map((chat) => ({
        ...chat,
        members: (chat.members || []).map((member) =>
          String(member?._id || member) === String(nextUser.id)
            ? { ...member, about: nextUser.about, avatarUrl: nextUser.avatarUrl }
            : member
        )
      }))
    );
    setRequests((prev) => ({
      incoming: (prev.incoming || []).map((req) => ({
        ...req,
        from:
          String(req.from?._id || req.from?.id || "") === String(nextUser.id)
            ? { ...(req.from || {}), about: nextUser.about, avatarUrl: nextUser.avatarUrl }
            : req.from,
        to:
          String(req.to?._id || req.to?.id || "") === String(nextUser.id)
            ? { ...(req.to || {}), about: nextUser.about, avatarUrl: nextUser.avatarUrl }
            : req.to
      })),
      outgoing: (prev.outgoing || []).map((req) => ({
        ...req,
        from:
          String(req.from?._id || req.from?.id || "") === String(nextUser.id)
            ? { ...(req.from || {}), about: nextUser.about, avatarUrl: nextUser.avatarUrl }
            : req.from,
        to:
          String(req.to?._id || req.to?.id || "") === String(nextUser.id)
            ? { ...(req.to || {}), about: nextUser.about, avatarUrl: nextUser.avatarUrl }
            : req.to
      }))
    }));
  }

  function openConfirmPopup({ title, message, confirmText = "Confirm", danger = false, onConfirm }) {
    setPopup({
      type: "confirm",
      title,
      message,
      confirmText,
      danger,
      onConfirm
    });
  }

  function saveNotificationSettings(next) {
    setNotificationSettings(next);
    try {
      localStorage.setItem("sc_notifications", JSON.stringify(next));
    } catch {}
  }

  function updateNotificationSetting(key, value) {
    saveNotificationSettings({ ...notificationSettingsRef.current, [key]: Boolean(value) });
  }

  async function requestDesktopPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setError("Desktop notifications are not supported in this browser.");
      return "denied";
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Desktop notification permission is not granted.");
      }
      return permission;
    } catch {
      setError("Failed to request desktop notification permission.");
      return "denied";
    }
  }

  function playNotificationSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => ctx.close();
    } catch {}
  }

  function pushInAppNotification(title, body) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPushToasts((prev) => [...prev.slice(-3), { id, title, body }]);
    setTimeout(() => {
      setPushToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }

  function notifyIncomingMessage(message) {
    if (String(message.senderId) === String(user?.id)) return;
    const currentSettings = notificationSettingsRef.current;
    const activeChatId = selectedChatIdRef.current;
    const visible = typeof document !== "undefined" && document.visibilityState === "visible";
    const inOpenChat = String(activeChatId) === String(message.chatId);
    if (currentSettings.onlyWhenInactive && inOpenChat && visible) return;

    const chat = chatsRef.current.find((c) => String(c._id) === String(message.chatId));
    const sender =
      usersRef.current.find((u) => String(u._id) === String(message.senderId)) ||
      chat?.members?.find((m) => String(m._id) === String(message.senderId));
    const senderName = sender?.name || "New message";
    const title = chat?.type === "group" ? `${senderName} in ${chat?.name || "Group"}` : senderName;
    const body =
      message.type === "image"
        ? "Sent a photo"
        : message.type === "file"
        ? `Sent a file${message.fileName ? `: ${message.fileName}` : ""}`
        : message.encrypted
        ? "New encrypted message"
        : message.content || "New message";

    if (currentSettings.push) {
      pushInAppNotification(title, body);
    }
    if (currentSettings.sound) {
      playNotificationSound();
    }
    if (currentSettings.desktop && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      }
    }
  }

  // Effect block: initial data load, chat/message refresh, socket wiring, and UI listeners.
  useEffect(() => {
    async function loadBootstrap() {
      try {
        const [uRes, rRes, eRes] = await Promise.all([
          api("/api/users"),
          api("/api/requests"),
          api("/api/emojis").catch(() => ({ custom: [] }))
        ]);
        setUsers(uRes.users || []);
        setRequests(rRes || { incoming: [], outgoing: [] });
        setCustomEmojis(Array.isArray(eRes?.custom) ? eRes.custom : []);
      } catch (err) {
        setError(err.message);
      }
    }
    loadBootstrap();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadChats() {
      try {
        const basePath = `/api/chats?filter=${chatFilter}`;
        const path =
          chatFilter === "locked"
            ? `${basePath}&passwordDigest=${encodeURIComponent(lockedAccessDigest)}`
            : basePath;
        if (chatFilter === "locked" && !lockedAccessDigest) {
          if (!cancelled) setChats([]);
          return;
        }
        const cRes = await api(path);
        if (cancelled) return;
        setChats((cRes.chats || []).map((chat) => withChatUnread(chat)));
      } catch (err) {
        if (!cancelled) {
          setChats([]);
          setError(err.message);
        }
      }
    }

    loadChats();
    return () => {
      cancelled = true;
    };
  }, [chatFilter, lockedAccessDigest]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    decryptedImageUrlsRef.current = decryptedImageUrls;
  }, [decryptedImageUrls]);

  useEffect(() => {
    let cancelled = false;
    const encryptedImageMessages = messages.filter(
      (message) => message?.type === "image" && message?.encrypted && message?.fileKey
    );
    const activeIds = new Set(encryptedImageMessages.map((message) => String(message._id)));

    setDecryptedImageUrls((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [messageId, url] of Object.entries(prev)) {
        if (activeIds.has(String(messageId))) continue;
        URL.revokeObjectURL(url);
        delete next[messageId];
        changed = true;
      }
      return changed ? next : prev;
    });

    for (const message of encryptedImageMessages) {
      const messageId = String(message._id);
      if (!messageId || decryptingImageRef.current.has(messageId) || decryptedImageUrlsRef.current[messageId]) continue;
      decryptingImageRef.current.add(messageId);

      (async () => {
        try {
          const blob = await fetchMessageFileBlob(message);
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          setDecryptedImageUrls((prev) => {
            if (prev[messageId]) {
              URL.revokeObjectURL(objectUrl);
              return prev;
            }
            return { ...prev, [messageId]: objectUrl };
          });
        } catch {
          // Ignore preview failures for encrypted media.
        } finally {
          decryptingImageRef.current.delete(messageId);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [messages, user.id]);

  useEffect(() => {
    return () => {
      for (const objectUrl of Object.values(decryptedImageUrlsRef.current || {})) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    notificationSettingsRef.current = notificationSettings;
  }, [notificationSettings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleWindowResize = () => {
      setSidebarWidth((prev) => clampSidebarWidth(prev));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    if (isMobileViewport) return;
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
    } catch {}
  }, [sidebarWidth, isMobileViewport]);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const handlePointerMove = (event) => {
      const delta = event.clientX - sidebarResizeStartXRef.current;
      const nextWidth = sidebarResizeStartWidthRef.current + delta;
      setSidebarWidth(clampSidebarWidth(nextWidth));
    };

    const handlePointerUp = () => setIsSidebarResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isSidebarResizing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 960px)");
    const syncViewport = () => {
      const nextMobile = mediaQuery.matches;
      setIsMobileViewport(nextMobile);
      if (!nextMobile) {
        setIsSidebarOpen(true);
      } else if (selectedChatIdRef.current) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    syncViewport();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }
    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    if (!selectedChatId) {
      setIsSidebarOpen(true);
    }
  }, [selectedChatId, isMobileViewport]);

  useEffect(() => {
    if (showInfo && selectedChatIdRef.current) {
      const active = chatsRef.current.find((chat) => String(chat._id) === String(selectedChatIdRef.current));
      if (active?.type === "group") {
        setGroupNameDraft(active.name || "");
        setGroupMotiveDraft(active.motive || "");
        setGroupAvatarUrlDraft(active.avatarUrl || "");
        if (groupAvatarPreviewUrl) {
          URL.revokeObjectURL(groupAvatarPreviewUrl);
        }
        setGroupAvatarPreviewUrl("");
        setGroupAvatarFile(null);
      }
    }
  }, [showInfo, selectedChatId]);

  useEffect(() => {
    return () => {
      if (groupAvatarPreviewUrl) {
        URL.revokeObjectURL(groupAvatarPreviewUrl);
      }
    };
  }, [groupAvatarPreviewUrl]);

  useEffect(() => {
    async function ensureE2EEIdentity() {
      if (!user?.id || e2eeInitAttempted.current) return;
      e2eeInitAttempted.current = true;

      try {
        if (typeof window === "undefined" || !window.crypto?.subtle) {
          setError("End-to-end encryption requires HTTPS (or localhost). Open this app over a secure URL.");
          return;
        }

        await ensureUserKeyPair(
          user.id,
          user.e2eePublicKeySpkiB64 || "",
          async (publicSpkiB64) => {
            const res = await api("/api/users/me/e2ee-key", {
              method: "PATCH",
              body: JSON.stringify({ e2eePublicKeySpkiB64: publicSpkiB64 })
            });
            if (res?.user) {
              const nextUser = toStoredUser(res.user);
              syncCurrentUserProfile(nextUser);
            }
          }
        );
      } catch (err) {
        setError(err?.message || "Unable to initialize encryption keys on this device.");
      }
    }

    ensureE2EEIdentity();
  }, [user?.id]);

  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    setSocketInstance(socket);

    socket.on("presence", ({ online }) => setOnline(online));
    socket.on("typing", ({ chatId, userId, isTyping }) => {
      setTypingMap((prev) => {
        const current = new Set(prev[chatId] || []);
        if (isTyping) current.add(userId);
        else current.delete(userId);
        return { ...prev, [chatId]: Array.from(current) };
      });
    });
    socket.on("message:new", (message) => {
      const isSelected = String(message.chatId) === String(selectedChatIdRef.current);
      const isIncoming = String(message.senderId) !== String(user.id);
      setMessages((prev) => (isSelected ? appendUniqueMessage(prev, message) : prev));
      setChats((prev) => {
        let updatedChat = null;
        const next = [];

        for (const chat of prev) {
          if (String(chat._id) !== String(message.chatId)) {
            next.push(chat);
            continue;
          }
          const currentUnread = normalizeUnreadCount(chat.unreadCount);
          updatedChat = {
            ...chat,
            lastMessageAt: message.createdAt,
            unreadCount: isIncoming ? (isSelected ? 0 : currentUnread + 1) : currentUnread
          };
        }

        if (!updatedChat) return prev;
        return [updatedChat, ...next];
      });
      if (isSelected && isIncoming && message?._id) {
        api(`/api/messages/${message.chatId}/read`, {
          method: "POST",
          body: JSON.stringify({ messageIds: [message._id] })
        }).catch(() => {});
      }
      notifyIncomingMessage(message);
    });
    socket.on("message:read", ({ chatId, messageIds, userId }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          String(msg.chatId) === String(chatId) && messageIds.includes(msg._id)
            ? { ...msg, readBy: Array.from(new Set([...(msg.readBy || []), userId])) }
            : msg
        )
      );
      if (String(userId) === String(user.id)) {
        setChats((prev) =>
          prev.map((chat) =>
            String(chat._id) === String(chatId) ? { ...chat, unreadCount: 0 } : chat
          )
        );
      }
    });
    socket.on("message:delivered", ({ chatId, messageIds, userId }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          String(msg.chatId) === String(chatId) && messageIds.includes(msg._id)
            ? { ...msg, deliveredTo: Array.from(new Set([...(msg.deliveredTo || []), userId])) }
            : msg
        )
      );
    });
    socket.on("message:deleted", ({ chatId, messageIds }) => {
      if (String(chatId) !== String(selectedChatIdRef.current)) return;
      const deletedSet = new Set((messageIds || []).map(String));
      setMessages((prev) => prev.filter((m) => !deletedSet.has(String(m._id))));
      setSelectedMessageIds((prev) => prev.filter((id) => !deletedSet.has(String(id))));
      setReplyToMessageId((prev) => (prev && deletedSet.has(String(prev)) ? null : prev));
      setEditingMessageId((prev) => (prev && deletedSet.has(String(prev)) ? "" : prev));
    });
    socket.on("message:updated", ({ chatId, message }) => {
      if (!message?._id) return;
      if (String(chatId) !== String(selectedChatIdRef.current)) return;
      setMessages((prev) =>
        prev.map((entry) =>
          String(entry._id) === String(message._id)
            ? { ...entry, ...message }
            : entry
        )
      );
      if (message.type === "text") {
        setRendered((prev) => ({
          ...prev,
          [message._id]: message.encrypted ? prev[message._id] || "..." : message.content || ""
        }));
      }
    });
    socket.on("message:reaction", ({ chatId, messageId, reactions }) => {
      if (!messageId) return;
      if (String(chatId) !== String(selectedChatIdRef.current)) return;
      setMessages((prev) =>
        prev.map((entry) =>
          String(entry._id) === String(messageId)
            ? { ...entry, reactions: Array.isArray(reactions) ? reactions : [] }
            : entry
        )
      );
    });
    socket.on("chat:vanish", ({ chatId, enabled }) => {
      setChats((prev) =>
        prev.map((chat) =>
          String(chat._id) === String(chatId) ? { ...chat, vanishMode: Boolean(enabled) } : chat
        )
      );
    });
    socket.on("chat:pin", ({ chatId, pinnedMessage }) => {
      setChats((prev) =>
        prev.map((chat) =>
          String(chat._id) === String(chatId) ? { ...chat, pinnedMessageId: pinnedMessage || null } : chat
        )
      );
    });
    socket.on("chat:updated", (payload) => {
      const updatedChat = payload?.chat || payload;
      if (!updatedChat?._id) return;
      mergeChatUpdate(updatedChat);
    });
    socket.on("chat:lock-state", ({ chatId, isLocked }) => {
      if (!chatId) return;
      setChats((prev) =>
        prev.map((entry) =>
          String(entry._id) === String(chatId) ? { ...entry, isLocked: Boolean(isLocked) } : entry
        )
      );
    });
    socket.on("chat:member-removed", ({ chatId, memberId }) => {
      const normalizedChatId = String(chatId || "");
      const normalizedMemberId = String(memberId || "");
      if (!normalizedChatId || !normalizedMemberId) return;

      if (normalizedMemberId === String(user.id)) {
        setChats((prev) => prev.filter((chat) => String(chat._id) !== normalizedChatId));
        if (String(selectedChatIdRef.current) === normalizedChatId) {
          setSelectedChatId("");
          setMessages([]);
          setShowInfo(false);
          setSelectedMessageIds([]);
          setReplyToMessageId(null);
          setEditingMessageId("");
        }
        return;
      }

      setChats((prev) =>
        prev.map((chat) =>
          String(chat._id) === normalizedChatId
            ? {
                ...chat,
                members: (chat.members || []).filter(
                  (member) => String(member?._id || member) !== normalizedMemberId
                )
              }
            : chat
        )
      );
    });
    socket.on("chat:removed", ({ chatId }) => {
      const normalizedChatId = String(chatId || "");
      if (!normalizedChatId) return;
      setChats((prev) => prev.filter((chat) => String(chat._id) !== normalizedChatId));
      if (String(selectedChatIdRef.current) === normalizedChatId) {
        setSelectedChatId("");
        setMessages([]);
        setShowInfo(false);
        setSelectedMessageIds([]);
        setReplyToMessageId(null);
        setEditingMessageId("");
      }
    });

    return () => {
      setSocketInstance(null);
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMessages() {
      if (!selectedChatId) {
        setMessages([]);
        setMessagesLoading(false);
        return;
      }
      setMessagesLoading(true);
      setMessages([]);
      setRendered({});
      setFirstUnreadMessageId("");
      try {
        const res = await api(`/api/messages/${selectedChatId}`);
        if (cancelled) return;
        setMessages(res.messages);
        setChats((prev) =>
          prev.map((chat) =>
            String(chat._id) === String(selectedChatId) ? { ...chat, unreadCount: 0 } : chat
          )
        );

        const unread = res.messages.filter((m) => !m.readBy?.includes(user.id)).map((m) => m._id);
        setFirstUnreadMessageId(unread[0] ? String(unread[0]) : "");
        if (unread.length) {
          await api(`/api/messages/${selectedChatId}/read`, {
            method: "POST",
            body: JSON.stringify({ messageIds: unread })
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, user.id]);

  useEffect(() => {
    setShowInfo(false);
    setSelectedMessageIds([]);
    setReplyToMessageId(null);
    setEditingMessageId("");
    setFirstUnreadMessageId("");
  }, [selectedChatId]);

  // Resolve (decrypt) text messages so UI can display emojis and content
  useEffect(() => {
    let mounted = true;
    async function resolveAll() {
      const map = { ...rendered };
      const retryablePlaceholders = new Set([
        "[unable to decrypt]",
        "[missing private key]"
      ]);
      for (const msg of messages) {
        if (msg.type !== "text") continue;
        if (map[msg._id] && !retryablePlaceholders.has(map[msg._id])) continue;
        if (!msg.encrypted) {
          map[msg._id] = msg.content;
          continue;
        }
        try {
          const resolved = await resolveMessageText(msg);
          map[msg._id] = resolved;
        } catch (e) {
          map[msg._id] = "[unable to decrypt]";
        }
      }
      if (mounted) setRendered(map);
    }
    resolveAll();
    return () => {
      mounted = false;
    };
  }, [messages, selectedChatId, users, chats, user?.id]);

  function logout() {
    clearAuth();
    window.location.href = "/";
  }

  function clearSelectedChatView() {
    setSelectedChatId("");
    setMessages([]);
    setShowInfo(false);
    setSelectedMessageIds([]);
    setReplyToMessageId(null);
    setEditingMessageId("");
    setFirstUnreadMessageId("");
  }

  async function refreshChats(nextFilter = chatFilter, nextDigest = lockedAccessDigest) {
    const basePath = `/api/chats?filter=${nextFilter}`;
    const path =
      nextFilter === "locked"
        ? `${basePath}&passwordDigest=${encodeURIComponent(nextDigest)}`
        : basePath;
    const res = await api(path);
    setChats((res.chats || []).map((chat) => withChatUnread(chat)));
  }

  async function refreshBootstrapSilently() {
    const [uRes, rRes, eRes] = await Promise.all([
      api("/api/users"),
      api("/api/requests"),
      api("/api/emojis").catch(() => ({ custom: [] }))
    ]);
    setUsers(Array.isArray(uRes?.users) ? uRes.users : []);
    setRequests(rRes || { incoming: [], outgoing: [] });
    setCustomEmojis(Array.isArray(eRes?.custom) ? eRes.custom : []);
  }

  async function refreshMessagesSilently(chatId = selectedChatIdRef.current) {
    const normalizedChatId = String(chatId || "");
    if (!normalizedChatId) return;
    const res = await api(`/api/messages/${normalizedChatId}`);
    if (String(selectedChatIdRef.current) !== normalizedChatId) return;

    const serverMessages = Array.isArray(res?.messages) ? res.messages : [];
    setMessages((prev) => mergeMessages(prev, serverMessages));
    setChats((prev) =>
      prev.map((chat) =>
        String(chat._id) === normalizedChatId ? { ...chat, unreadCount: 0 } : chat
      )
    );

    const unread = serverMessages.filter((message) => !message.readBy?.includes(user.id)).map((message) => message._id);
    if (unread.length) {
      await api(`/api/messages/${normalizedChatId}/read`, {
        method: "POST",
        body: JSON.stringify({ messageIds: unread })
      });
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let cancelled = false;

    async function runSilentRefresh() {
      if (cancelled || silentRefreshRunningRef.current) return;
      if (document.visibilityState !== "visible") return;
      silentRefreshRunningRef.current = true;
      try {
        const jobs = [
          refreshBootstrapSilently(),
          ...(chatFilter === "locked" && !lockedAccessDigest ? [] : [refreshChats(chatFilter, lockedAccessDigest)]),
          ...(selectedChatIdRef.current ? [refreshMessagesSilently(selectedChatIdRef.current)] : [])
        ];
        await Promise.allSettled(jobs);
      } finally {
        silentRefreshRunningRef.current = false;
      }
    }

    const onFocus = () => {
      runSilentRefresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runSilentRefresh();
      }
    };

    const intervalId = window.setInterval(runSilentRefresh, UI_SILENT_REFRESH_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [chatFilter, lockedAccessDigest, user.id]);

  function openLockedChatsGate() {
    openChatLockPrompt({
      mode: "accessLocked",
      chatId: "",
      chatName: "",
      openAfterUnlock: false
    });
  }

  async function openUnlockedChatsView() {
    setChatFilter("unlocked");
    setLockedAccessDigest("");
    clearSelectedChatView();
    await refreshChats("unlocked", "");
  }

  function requestLockSelectedChat(targetChatId) {
    const normalizedTarget = String(targetChatId || selectedChatIdRef.current || "");
    if (!normalizedTarget) {
      setError("Open a private chat first.");
      return;
    }

    const targetChat = chatsRef.current.find((chat) => String(chat._id) === normalizedTarget);
    if (!targetChat || targetChat.type !== "direct") {
      setError("Lock chat is only available for private chats.");
      return;
    }

    if (targetChat.isLocked) {
      promptUnlockLockedChat(targetChat, { openAfterUnlock: false });
      return;
    }

    openChatLockPrompt({
      mode: "lock",
      chatId: normalizedTarget,
      chatName: getChatTitle(targetChat),
      openAfterUnlock: false
    });
  }

  function requestUnlockSelectedChat(targetChatId) {
    const normalizedTarget = String(targetChatId || selectedChatIdRef.current || "");
    if (!normalizedTarget) {
      setError("Select a locked private chat first.");
      return;
    }

    const targetChat = chatsRef.current.find((chat) => String(chat._id) === normalizedTarget);
    if (!targetChat || targetChat.type !== "direct") {
      setError("Unlock chat is only available for private chats.");
      return;
    }

    if (!targetChat.isLocked) {
      setError("This chat is not locked.");
      return;
    }

    promptUnlockLockedChat(targetChat, { openAfterUnlock: false });
  }

  async function submitChatLockPrompt(event) {
    event?.preventDefault();
    const normalizedChatId = String(chatLockPrompt?.chatId || "");
    const password = String(chatLockPassword || "");

    if (!password) {
      setChatLockPromptError("Password is required.");
      return;
    }

    if (chatLockPrompt.mode === "lock") {
      if (password.length < 4) {
        setChatLockPromptError("Password must be at least 4 characters.");
        return;
      }
    }

    setChatLockPromptBusy(true);
    setChatLockPromptError("");

    try {
      const passwordDigest = await toPasswordDigest(password);

      if (chatLockPrompt.mode === "accessLocked") {
        await refreshChats("locked", passwordDigest);
        setChatFilter("locked");
        setLockedAccessDigest(passwordDigest);
        clearSelectedChatView();
        setChatLockPrompt(null);
        setChatLockPassword("");
        return;
      }

      if (chatLockPrompt.mode === "lock") {
        await api(`/api/chats/${normalizedChatId}/lock`, {
          method: "POST",
          body: JSON.stringify({ passwordDigest })
        });
        await refreshChats(chatFilter, lockedAccessDigest);
        setChatLockPrompt(null);
        setChatLockPassword("");
        if (String(selectedChatIdRef.current) === normalizedChatId) {
          clearSelectedChatView();
          if (isMobileViewport) setIsSidebarOpen(true);
        }
        return;
      }

      await api(`/api/chats/${normalizedChatId}/unlock`, {
        method: "POST",
        body: JSON.stringify({ passwordDigest })
      });

      const shouldOpenAfterUnlock = Boolean(chatLockPrompt.openAfterUnlock);
      setChatLockPrompt(null);
      setChatLockPassword("");

      if (shouldOpenAfterUnlock) {
        setChatFilter("unlocked");
        setLockedAccessDigest("");
        await refreshChats("unlocked", "");
        openUnlockedChatById(normalizedChatId);
      } else {
        await refreshChats(chatFilter, lockedAccessDigest);
      }
    } catch (err) {
      setChatLockPromptError(err?.message || "Unable to update chat lock.");
    } finally {
      setChatLockPromptBusy(false);
    }
  }

  async function sendRequest(toUserId) {
    try {
      setError("");
      const res = await api("/api/requests", { method: "POST", body: JSON.stringify({ toUserId }) });
      if (res.request) {
        setRequests((prev) => ({
          ...prev,
          outgoing: [res.request, ...prev.outgoing.filter((r) => String(r._id) !== String(res.request._id))]
        }));
      }
      if (res.chat) {
        setChats((prev) => {
          const exists = prev.some((c) => String(c._id) === String(res.chat._id));
          return exists ? prev : [withChatUnread(res.chat), ...prev];
        });
        openChatById(String(res.chat._id));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function respondRequest(requestId, status) {
    try {
      const res = await api(`/api/requests/${requestId}/respond`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      setRequests((prev) => ({
        incoming: prev.incoming.map((r) => (r._id === requestId ? res.request : r)),
        outgoing: prev.outgoing
      }));
      if (res.chat) {
        setChats((prev) => [withChatUnread(res.chat), ...prev]);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function createGroup(name, memberIds) {
    try {
      const res = await api("/api/chats/group", {
        method: "POST",
        body: JSON.stringify({ name, memberIds })
      });
      setChats((prev) => [withChatUnread(res.chat), ...prev]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleVanishMode(enabled) {
    if (!selectedChatId) return;
    try {
      setError("");
      await api(`/api/chats/${selectedChatId}/vanish`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
      setChats((prev) =>
        prev.map((chat) =>
          String(chat._id) === String(selectedChatId) ? { ...chat, vanishMode: Boolean(enabled) } : chat
        )
      );
    } catch (err) {
      setError(err.message || "Failed to update vanish mode");
    }
  }

  function openGroupAvatarPicker() {
    groupAvatarInputRef.current?.click();
  }

  function clearGroupAvatarPreview() {
    if (groupAvatarPreviewUrl) {
      URL.revokeObjectURL(groupAvatarPreviewUrl);
    }
    setGroupAvatarPreviewUrl("");
    setGroupAvatarFile(null);
  }

  function handleGroupAvatarSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setError("Please choose an image file for group photo.");
      return;
    }
    clearGroupAvatarPreview();
    setGroupAvatarFile(file);
    setGroupAvatarPreviewUrl(URL.createObjectURL(file));
  }

  function removeGroupAvatarDraft() {
    clearGroupAvatarPreview();
    setGroupAvatarUrlDraft("");
  }

  async function saveGroupProfile() {
    if (!selectedChat || selectedChat.type !== "group") return;

    const trimmedName = String(groupNameDraft || "").trim();
    if (!trimmedName) {
      setError("Group name cannot be empty.");
      return;
    }

    try {
      setSavingGroupProfile(true);
      setError("");
      let nextAvatarUrl = String(groupAvatarUrlDraft || "");

      if (groupAvatarFile) {
        const form = new FormData();
        form.append("file", groupAvatarFile, groupAvatarFile.name || "group-avatar");
        const uploaded = await apiForm("/api/upload", form);
        nextAvatarUrl = uploaded?.url || "";
      }

      const res = await api(`/api/chats/${selectedChat._id}/group-profile`, {
        method: "PATCH",
        body: JSON.stringify({
          name: trimmedName,
          motive: String(groupMotiveDraft || ""),
          avatarUrl: nextAvatarUrl
        })
      });

      if (res?.chat) {
        mergeChatUpdate(res.chat);
        setGroupNameDraft(res.chat.name || "");
        setGroupMotiveDraft(res.chat.motive || "");
        setGroupAvatarUrlDraft(res.chat.avatarUrl || "");
        clearGroupAvatarPreview();
      }
    } catch (err) {
      setError(err.message || "Failed to update group profile");
    } finally {
      setSavingGroupProfile(false);
    }
  }

  function removeGroupMember(member) {
    if (!selectedChat || selectedChat.type !== "group") return;
    const memberId = String(member?._id || "");
    if (!memberId) return;

    openConfirmPopup({
      title: "Remove Member",
      message: `Remove ${member?.name || "this member"} from the group?`,
      confirmText: "Remove",
      danger: true,
      onConfirm: async () => {
        try {
          setRemovingMemberId(memberId);
          const res = await api(`/api/chats/${selectedChat._id}/members/${memberId}`, {
            method: "DELETE"
          });
          if (res?.chat) {
            mergeChatUpdate(res.chat);
          }
        } catch (err) {
          setError(err.message || "Failed to remove member");
        } finally {
          setRemovingMemberId("");
        }
      }
    });
  }

  async function deleteMessageForMe(messageIds) {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    if (ids.length === 0) return;
    openConfirmPopup({
      title: "Delete Message",
      message: `Delete ${ids.length} message${ids.length > 1 ? "s" : ""} for you?`,
      confirmText: "Delete",
      onConfirm: async () => {
        const idSet = new Set(ids.map(String));
        const snapshot = messagesRef.current.filter((msg) => idSet.has(String(msg._id)));
        setMessages((prev) => prev.filter((msg) => !idSet.has(String(msg._id))));
        setSelectedMessageIds((prev) => prev.filter((id) => !idSet.has(String(id))));
        setReplyToMessageId((prev) => (prev && idSet.has(String(prev)) ? null : prev));
        setEditingMessageId((prev) => (prev && idSet.has(String(prev)) ? "" : prev));
        try {
          await Promise.all(ids.map((id) => api(`/api/messages/${id}?scope=me`, { method: "DELETE" })));
        } catch (err) {
          setMessages((prev) => mergeMessages(prev, snapshot));
          setError(err?.message || "Failed to delete message");
        }
      }
    });
  }

  async function deleteMessageForEveryone(messageIds) {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    if (ids.length === 0) return;
    openConfirmPopup({
      title: "Delete For Everyone",
      message: `Delete ${ids.length} message${ids.length > 1 ? "s" : ""} for everyone?`,
      confirmText: "Delete for everyone",
      danger: true,
      onConfirm: async () => {
        const idSet = new Set(ids.map(String));
        const snapshot = messagesRef.current.filter((msg) => idSet.has(String(msg._id)));
        setMessages((prev) => prev.filter((msg) => !idSet.has(String(msg._id))));
        setSelectedMessageIds((prev) => prev.filter((id) => !idSet.has(String(id))));
        setReplyToMessageId((prev) => (prev && idSet.has(String(prev)) ? null : prev));
        setEditingMessageId((prev) => (prev && idSet.has(String(prev)) ? "" : prev));
        try {
          await Promise.all(ids.map((id) => api(`/api/messages/${id}?scope=everyone`, { method: "DELETE" })));
        } catch (err) {
          setMessages((prev) => mergeMessages(prev, snapshot));
          setError(err?.message || "Failed to delete message");
        }
      }
    });
  }

  function quickDeleteMessage(message) {
    const messageId = String(message?._id || "");
    if (!messageId) return;
    deleteMessageForMe([messageId]);
  }

  async function refreshUsersFromServer() {
    const res = await api("/api/users");
    const nextUsers = Array.isArray(res?.users) ? res.users : [];
    setUsers(nextUsers);
    return nextUsers;
  }

  async function getDirectChatPeer(chat) {
    const otherRef = chat.members.find((m) => String(m._id || m) !== String(user.id));
    let other = typeof otherRef === "string" ? users.find((u) => String(u._id) === String(otherRef)) : otherRef;
    const receiverId = String(other?._id || other || "");
    let receiverPublicKeySpkiB64 = other?.e2eePublicKeySpkiB64 || "";
    const senderPublicKeySpkiB64 = user?.e2eePublicKeySpkiB64 || "";

    if (receiverId) {
      try {
        const latestUsers = await refreshUsersFromServer();
        const latestOther = latestUsers.find((entry) => String(entry?._id || entry?.id) === receiverId);
        if (latestOther?.e2eePublicKeySpkiB64) {
          other = latestOther;
          receiverPublicKeySpkiB64 = latestOther.e2eePublicKeySpkiB64;
        }
      } catch {
        // Fall back to cached user list when live refresh is unavailable.
      }
    }

    if (!receiverId || !receiverPublicKeySpkiB64) {
      throw new Error("Recipient encryption key not available yet. Ask them to login once.");
    }
    if (!senderPublicKeySpkiB64) {
      throw new Error("Your encryption key is not initialized yet.");
    }
    return { receiverId, receiverPublicKeySpkiB64, senderPublicKeySpkiB64 };
  }

  function createPendingMessage({
    chat,
    type,
    content = "",
    fileUrl = "",
    fileName = "",
    mimeType = "",
    size = 0,
    replyTo = null
  }) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      _id: tempId,
      chatId: chat._id,
      senderId: user.id,
      type,
      content: content || fileUrl || "",
      encrypted: false,
      fileUrl: fileUrl || "",
      fileName,
      mimeType,
      size,
      fileSize: size,
      readBy: [user.id],
      deliveredTo: [user.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replyTo: replyTo || null
    };
  }

  function queueMessageSend({ chat, pendingMessage, commit }) {
    const tempId = String(pendingMessage._id);
    setMessages((prev) => appendUniqueMessage(prev, pendingMessage));
    if (pendingMessage.type === "text") {
      setRendered((prev) => ({ ...prev, [tempId]: pendingMessage.content || "" }));
    }
    setChats((prev) =>
      prev.map((entry) =>
        String(entry._id) === String(chat._id)
          ? { ...entry, lastMessageAt: pendingMessage.createdAt }
          : entry
      )
    );

    (async () => {
      try {
        const res = await commit();
        if (res?.message) {
          setMessages((prev) => replaceMessageById(prev, tempId, res.message));
          if (!res.message.encrypted && res.message.type === "text") {
            setRendered((prev) => ({ ...prev, [res.message._id]: res.message.content || "" }));
          }
          setChats((prev) =>
            prev.map((entry) =>
              String(entry._id) === String(res.message.chatId)
                ? { ...entry, lastMessageAt: res.message.createdAt }
                : entry
            )
          );
        } else {
          setMessages((prev) => prev.filter((entry) => String(entry._id) !== tempId));
        }
      } catch (err) {
        setMessages((prev) => prev.filter((entry) => String(entry._id) !== tempId));
        setRendered((prev) => {
          const next = { ...prev };
          delete next[tempId];
          return next;
        });
        setError(err?.message || "Failed to send message");
      }
    })();
  }

  async function togglePinSelectedMessage(singleSelectedMessage) {
    const chat = chats.find((c) => String(c._id) === String(selectedChatId));
    if (!chat || !singleSelectedMessage?._id) return;
    const isPinned = String(chat.pinnedMessageId?._id || chat.pinnedMessageId) === String(singleSelectedMessage._id);
    const nextMessageId = isPinned ? null : singleSelectedMessage._id;

    try {
      const res = await api(`/api/chats/${selectedChatId}/pin`, {
        method: "PATCH",
        body: JSON.stringify({ messageId: nextMessageId })
      });
      setChats((prev) =>
        prev.map((c) =>
          String(c._id) === String(selectedChatId)
            ? { ...c, pinnedMessageId: res.chat?.pinnedMessageId ?? null }
            : c
        )
      );
      setSelectedMessageIds([]);
    } catch (err) {
      setError(err.message || "Failed to update pinned message");
    }
  }

  function startReplyFromSelected(singleSelectedMessage) {
    if (!singleSelectedMessage?._id) return;
    setReplyToMessageId(singleSelectedMessage._id);
    setEditingMessageId("");
    setSelectedMessageIds([]);
  }

  function startEditMessage(message) {
    if (!message?._id) return;
    if (String(message.senderId) !== String(user.id) || message.type !== "text") return;
    const createdAtMs = new Date(message.createdAt).getTime();
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > MAX_EDIT_WINDOW_MS) {
      setError("You can only edit a message within 15 minutes of sending.");
      return;
    }
    setEditingMessageId(String(message._id));
    setReplyToMessageId(null);
    setSelectedMessageIds([]);
  }

  async function saveMessageEdit(nextText) {
    const message = messages.find((entry) => String(entry._id) === String(editingMessageId));
    const chat = chats.find((entry) => String(entry._id) === String(selectedChatId));
    if (!message || !chat) return;
    if (!nextText?.trim()) return;
    const createdAtMs = new Date(message.createdAt).getTime();
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > MAX_EDIT_WINDOW_MS) {
      setEditingMessageId("");
      setError("You can only edit a message within 15 minutes of sending.");
      return;
    }

    try {
      let payload = { content: nextText.trim(), encrypted: false };
      if (chat.type === "direct") {
        const direct = await getDirectChatPeer(chat);
        const encryptedPayload = await encryptForReceiver({
          senderId: user.id,
          receiverId: direct.receiverId,
          chatId: chat._id,
          senderPublicSpkiB64: direct.senderPublicKeySpkiB64,
          receiverPublicSpkiB64: direct.receiverPublicKeySpkiB64,
          plainText: nextText.trim()
        });
        payload = {
          encrypted: true,
          receiverId: direct.receiverId,
          content: encryptedPayload.ciphertextB64,
          ciphertextB64: encryptedPayload.ciphertextB64,
          iv: encryptedPayload.ivB64,
          wrappedKeyB64: encryptedPayload.wrappedKeyB64,
          senderWrappedKeyB64: encryptedPayload.senderWrappedKeyB64,
          aadB64: encryptedPayload.aadB64,
          clientTs: encryptedPayload.clientTs,
          clientMsgId: encryptedPayload.clientMsgId,
          integrityHash: encryptedPayload.integrityHash
        };
      }

      const res = await api(`/api/messages/${message._id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      if (res?.message) {
        setMessages((prev) =>
          prev.map((entry) => (String(entry._id) === String(res.message._id) ? { ...entry, ...res.message } : entry))
        );
      }
      setEditingMessageId("");
    } catch (err) {
      setError(err?.message || "Failed to edit message");
    }
  }

  async function toggleReaction(message, emoji) {
    const messageId = String(message?._id || "");
    if (!messageId || !emoji) return;
    try {
      const res = await api(`/api/messages/${messageId}/reaction`, {
        method: "PATCH",
        body: JSON.stringify({ emoji })
      });
      setMessages((prev) =>
        prev.map((entry) =>
          String(entry._id) === messageId
            ? { ...entry, reactions: Array.isArray(res.reactions) ? res.reactions : [] }
            : entry
        )
      );
    } catch (err) {
      setError(err?.message || "Failed to react to message");
    }
  }

  async function sendText(text) {
    const chat = chats.find((c) => String(c._id) === String(selectedChatId));
    if (!chat) return;

    try {
      let payload = { type: "text", content: text, encrypted: false };
      if (chat.type === "direct") {
        const direct = await getDirectChatPeer(chat);
        const encryptedPayload = await encryptForReceiver({
          senderId: user.id,
          receiverId: direct.receiverId,
          chatId: chat._id,
          senderPublicSpkiB64: direct.senderPublicKeySpkiB64,
          receiverPublicSpkiB64: direct.receiverPublicKeySpkiB64,
          plainText: text
        });
        payload = {
          type: "text",
          encrypted: true,
          receiverId: direct.receiverId,
          content: encryptedPayload.ciphertextB64,
          ciphertextB64: encryptedPayload.ciphertextB64,
          iv: encryptedPayload.ivB64,
          wrappedKeyB64: encryptedPayload.wrappedKeyB64,
          senderWrappedKeyB64: encryptedPayload.senderWrappedKeyB64,
          aadB64: encryptedPayload.aadB64,
          clientTs: encryptedPayload.clientTs,
          clientMsgId: encryptedPayload.clientMsgId,
          integrityHash: encryptedPayload.integrityHash
        };
      }

      if (replyToMessageId) {
        payload.replyTo = replyToMessageId;
      }

      const pendingMessage = createPendingMessage({
        chat,
        type: "text",
        content: text,
        replyTo: replyToMessageId
      });
      queueMessageSend({
        chat,
        pendingMessage,
        commit: () => api(`/api/messages/${chat._id}`, { method: "POST", body: JSON.stringify(payload) })
      });
      setReplyToMessageId(null);
      setEditingMessageId("");
    } catch (err) {
      setError(err.message);
    }
  }

  function sendTyping(isTyping) {
    if (!selectedChatId) return;
    socketRef.current?.emit("typing", { chatId: selectedChatId, isTyping });
  }

  async function sendFile(file, { uploadType = "file" } = {}) {
    const chat = chats.find((c) => String(c._id) === String(selectedChatId));
    if (!chat) return;
    const normalizedMime = String(file?.type || "").toLowerCase();
    const isImageUpload = uploadType === "image" || IMAGE_MIME_TYPES.has(normalizedMime);
    const messageType = isImageUpload ? "image" : "file";
    const localPreviewUrl = isImageUpload ? URL.createObjectURL(file) : "";

    try {
      const pendingMessage = createPendingMessage({
        chat,
        type: messageType,
        fileUrl: localPreviewUrl,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        replyTo: replyToMessageId
      });

      const commit = async () => {
        setIsUploadingAttachment(true);
        setUploadProgress(0);

        try {
          if (chat.type === "direct") {
            const direct = await getDirectChatPeer(chat);
            const buffer = await file.arrayBuffer();
            const encryptedPayload = await encryptForReceiver({
              senderId: user.id,
              receiverId: direct.receiverId,
              chatId: chat._id,
              senderPublicSpkiB64: direct.senderPublicKeySpkiB64,
              receiverPublicSpkiB64: direct.receiverPublicKeySpkiB64,
              binaryData: buffer
            });
            const blob = new Blob([base64ToArrayBuffer(encryptedPayload.ciphertextB64)]);
            const form = new FormData();
            form.append("file", blob, "encrypted.bin");
            form.append("uploadType", messageType);
            form.append("originalName", file.name || "file");
            form.append("originalMimeType", file.type || "application/octet-stream");
            const upload = await apiUpload("/api/upload", form, {
              onProgress: setUploadProgress
            });

            socketRef.current?.emit("chat-message", {
              roomId: String(chat._id),
              message: {
                type: messageType,
                fileUrl: upload.url,
                fileName: file.name,
                fileSize: file.size,
                senderId: user.id,
                receiverId: direct.receiverId,
                timestamp: Date.now()
              }
            });

            return api(`/api/messages/${chat._id}`, {
              method: "POST",
              body: JSON.stringify({
                type: messageType,
                encrypted: true,
                receiverId: direct.receiverId,
                iv: encryptedPayload.ivB64,
                wrappedKeyB64: encryptedPayload.wrappedKeyB64,
                senderWrappedKeyB64: encryptedPayload.senderWrappedKeyB64,
                aadB64: encryptedPayload.aadB64,
                clientTs: encryptedPayload.clientTs,
                clientMsgId: encryptedPayload.clientMsgId,
                fileKey: upload.fileKey,
                fileUrl: upload.url,
                content: upload.url,
                fileName: file.name,
                mimeType: file.type,
                fileSize: file.size,
                size: file.size,
                replyTo: replyToMessageId || undefined
              })
            });
          }

          const form = new FormData();
          form.append("file", file, file.name);
          form.append("uploadType", messageType);
          form.append("originalName", file.name || "file");
          form.append("originalMimeType", file.type || "application/octet-stream");
          const upload = await apiUpload("/api/upload", form, {
            onProgress: setUploadProgress
          });

          socketRef.current?.emit("chat-message", {
            roomId: String(chat._id),
            message: {
              type: messageType,
              fileUrl: upload.url,
              fileName: upload.fileName,
              fileSize: upload.size,
              senderId: user.id,
              receiverId: null,
              timestamp: Date.now()
            }
          });

          return api(`/api/messages/${chat._id}`, {
            method: "POST",
            body: JSON.stringify({
              type: messageType,
              encrypted: false,
              fileKey: upload.fileKey,
              fileUrl: upload.url,
              content: upload.url,
              fileName: upload.fileName,
              mimeType: upload.mimeType,
              fileSize: upload.size,
              size: upload.size,
              replyTo: replyToMessageId || undefined
            })
          });
        } finally {
          setIsUploadingAttachment(false);
          setUploadProgress(0);
          if (localPreviewUrl) {
            URL.revokeObjectURL(localPreviewUrl);
          }
        }
      };

      queueMessageSend({
        chat,
        pendingMessage,
        commit
      });
      setReplyToMessageId(null);
      setEditingMessageId("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function fetchMessageFileBlob(message) {
    const authHeaders = (() => {
      const token = getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    })();

    const extractFileKey = (msg) => {
      const explicit = String(msg?.fileKey || "").trim();
      if (explicit) return explicit;
      const fromUrl = String(msg?.fileUrl || msg?.content || "").trim();
      if (!fromUrl) return "";
      if (fromUrl.startsWith("/uploads/")) {
        return fromUrl.split("/").filter(Boolean).pop() || "";
      }
      try {
        const parsed = new URL(fromUrl);
        if (parsed.pathname.startsWith("/uploads/")) {
          return parsed.pathname.split("/").filter(Boolean).pop() || "";
        }
      } catch {}
      return "";
    };

    const resolvePublicUploadUrl = (msg, fallbackKey = "") => {
      const value = String(msg?.fileUrl || msg?.content || "").trim();
      if (value.startsWith("http://") || value.startsWith("https://")) return value;
      if (value.startsWith("/uploads/")) return `${API_BASE}${value}`;
      if (fallbackKey) return `${API_BASE}/uploads/${fallbackKey}`;
      return "";
    };

    let res = null;
    const fileKey = extractFileKey(message);
    if (fileKey) {
      const secureRes = await fetch(`${API_BASE}/api/upload/${encodeURIComponent(fileKey)}`, {
        headers: authHeaders
      });
      if (secureRes.ok) {
        res = secureRes;
      } else {
        const publicUrl = resolvePublicUploadUrl(message, fileKey);
        if (publicUrl) {
          const fallbackRes = await fetch(publicUrl, { headers: authHeaders });
          if (fallbackRes.ok) {
            res = fallbackRes;
          } else {
            throw new Error(`Download failed (${secureRes.status}/${fallbackRes.status})`);
          }
        } else {
          throw new Error(`Download failed (${secureRes.status})`);
        }
      }
    } else {
      const publicUrl = resolvePublicUploadUrl(message);
      if (!publicUrl) {
        throw new Error("Download failed (file reference missing)");
      }
      const publicRes = await fetch(publicUrl, { headers: authHeaders });
      if (!publicRes.ok) {
        throw new Error(`Download failed (${publicRes.status})`);
      }
      res = publicRes;
    }

    const buffer = await res.arrayBuffer();

    let fileBuffer = buffer;
    if (message.encrypted) {
      if (!message.wrappedKeyB64 || !message.aadB64) {
        throw new Error("Legacy encrypted file format not supported");
      }
      fileBuffer = await decryptBinaryForCurrentUser({
        userId: user.id,
        message,
        cipherBuffer: buffer
      });
    }

    return new Blob([fileBuffer], { type: message.mimeType || "application/octet-stream" });
  }

  async function downloadFile(message) {
    try {
      const blob = await fetchMessageFileBlob(message);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = message.fileName || "file";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function resolveMessageText(message) {
    if (!message.encrypted) return message.content;
    if (!message.wrappedKeyB64 || !message.aadB64) return "[legacy encrypted message]";
    if (String(message.senderId) === String(user.id) && !message.senderWrappedKeyB64) {
      return "[legacy sent encrypted message]";
    }
    return decryptTextForCurrentUser({ userId: user.id, message });
  }

  const selectedChat = chats.find((c) => String(c._id) === String(selectedChatId));
  const selectedDirectPeer =
    selectedChat?.type === "direct"
      ? selectedChat.members.find((m) => String(m?._id || m) !== String(user.id)) || null
      : null;
  const isSelectedChatLocked = Boolean(selectedChat?.isLocked);
  const selectedPinnedMessage = selectedChat?.pinnedMessageId || null;
  const selectedGroupCreatorId = String(selectedChat?.createdBy?._id || selectedChat?.createdBy || "");
  const isSelectedGroupAdmin =
    selectedChat?.type === "group" && selectedGroupCreatorId === String(user.id);
  const directChatUser = getDirectUser(selectedChat);
  const directChatUserAvatarSrc = getAvatarSrc(directChatUser?.avatarUrl || "");
  const groupAvatarDraftSrc = groupAvatarPreviewUrl || getAvatarSrc(groupAvatarUrlDraft || "");
  const groupAvatarFallback = (groupNameDraft || selectedChat?.name || "G").slice(0, 1).toUpperCase();
  const replyTargetMessage = messages.find((m) => String(m._id) === String(replyToMessageId)) || null;
  const editingTargetMessage = messages.find((m) => String(m._id) === String(editingMessageId)) || null;
  const selectedMessages = messages.filter((m) => selectedMessageIds.includes(String(m._id)));
  const singleSelectedMessage = selectedMessages.length === 1 ? selectedMessages[0] : null;
  const ownSelectedMessageIds = selectedMessages
    .filter((m) => String(m.senderId) === String(user.id))
    .map((m) => String(m._id));
  const usersById = useMemo(() => {
    const map = {};
    users.forEach((u) => {
      map[u._id] = u;
    });
    if (user) map[user.id] = user;
    return map;
  }, [users, user]);
  const selectedGroupCreatorName =
    usersById[selectedGroupCreatorId]?.name || selectedChat?.createdBy?.name || "Unknown";
  const visibleChats = useMemo(
    () => chats.filter((chat) => !archivedChatIds.includes(String(chat._id))),
    [chats, archivedChatIds]
  );
  const selectedPeerUserId = String(selectedDirectPeer?._id || selectedDirectPeer || "");
  const {
    callState,
    localStream,
    remoteStream,
    isMicMuted,
    isCameraOff,
    isRemoteSpeaking,
    isBusy: isCallBusy,
    startVoiceCall,
    startVideoCall,
    acceptIncomingCall,
    rejectIncomingCall,
    endCall,
    toggleMute,
    toggleCamera
  } = useCallManager({
    socket: socketInstance,
    currentUserId: user.id,
    selectedChatId,
    selectedPeerUserId
  });
  const activeCallPeer =
    usersById[callState.peerUserId] ||
    selectedDirectPeer ||
    users.find((entry) => String(entry._id) === String(callState.peerUserId)) ||
    null;

  function formatDate(value) {
    if (!value) return "Unknown";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "Unknown";
    }
  }

  function getChatTitle(chat) {
    if (!chat) return "Unknown";
    if (chat.type === "group") return chat.name || "Group";
    const other = chat.members.find((m) => String(m._id) !== String(user.id));
    return other?.name || "Unknown";
  }

  function getDirectUser(chat) {
    if (!chat || chat.type !== "direct") return null;
    return chat.members.find((m) => String(m._id) !== String(user.id)) || null;
  }

  function getMessagePreview(msg) {
    if (!msg) return "";
    if (msg.type === "image") return msg.fileName ? `Photo: ${msg.fileName}` : "Photo";
    if (msg.type === "file") return msg.fileName || "File";
    if (msg.encrypted) return rendered[msg._id] || "Encrypted message";
    return msg.content || "Message";
  }

  function handleSelectMessage(message) {
    const id = String(message?._id || "");
    if (!id) return;
    setSelectedMessageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function archiveSelectedChat() {
    if (!selectedChatId) return;
    const normalized = String(selectedChatId);
    setArchivedChatIds((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setSelectedChatId("");
    setMessages([]);
  }

  function requestSidebarCall(chatId, mode) {
    const normalizedChatId = String(chatId || "");
    if (!normalizedChatId) return;
    if (isCallBusy) {
      setError("You are already in an active call.");
      return;
    }
    setPendingSidebarCall({
      chatId: normalizedChatId,
      mode: mode === "video" ? "video" : "voice"
    });
    openChatById(normalizedChatId);
  }

  useEffect(() => {
    try {
      localStorage.setItem(ARCHIVED_CHATS_KEY, JSON.stringify(archivedChatIds));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [ARCHIVED_CHATS_KEY, archivedChatIds]);

  useEffect(() => {
    if (!pendingSidebarCall) return;
    if (String(selectedChatId) !== String(pendingSidebarCall.chatId)) return;
    if (!selectedChat || selectedChat.type !== "direct") {
      setPendingSidebarCall(null);
      return;
    }
    if (isCallBusy) {
      setPendingSidebarCall(null);
      return;
    }
    if (pendingSidebarCall.mode === "video") startVideoCall();
    else startVoiceCall();
    setPendingSidebarCall(null);
  }, [
    isCallBusy,
    pendingSidebarCall,
    selectedChat,
    selectedChatId,
    startVideoCall,
    startVoiceCall
  ]);

  // Render block: overall chat shell and child feature panels.
  return (
    <div
      className={`chat-app shell-mode ${isMobileViewport ? "mobile" : ""} ${isSidebarOpen ? "sidebar-open" : ""} ${
        selectedChat ? "has-selected-chat" : "no-selected-chat"
      } ${isSidebarResizing ? "sidebar-resizing" : ""}`}
    >
      <Sidebar
        user={user}
        chats={visibleChats}
        selectedChatId={selectedChatId}
        requests={requests}
        users={users}
        online={online}
        onSelectChat={openChatById}
        onSendRequest={sendRequest}
        onRespondRequest={respondRequest}
        onCreateGroup={createGroup}
        onLogout={logout}
        activeChatFilter={chatFilter}
        onOpenLockedChats={openLockedChatsGate}
        onOpenUnlockedChats={openUnlockedChatsView}
        onArchiveSelectedChat={archiveSelectedChat}
        onStartVoiceCall={(chatId) => requestSidebarCall(chatId, "voice")}
        onStartVideoCall={(chatId) => requestSidebarCall(chatId, "video")}
        notificationSettings={notificationSettings}
        onUpdateNotificationSetting={updateNotificationSetting}
        onRequestDesktopPermission={requestDesktopPermission}
        error={error}
        sidebarStyle={!isMobileViewport ? { width: `${Math.round(sidebarWidth)}px` } : undefined}
      />

      {!isMobileViewport && (
        <button
          type="button"
          className="sidebar-resizer"
          onPointerDown={onSidebarResizerPointerDown}
          onKeyDown={onSidebarResizerKeyDown}
          aria-label="Resize sidebar"
          title="Drag to resize sidebar"
        />
      )}

      <main className="main-content">
        <CallOverlay
          callState={callState}
          localStream={localStream}
          remoteStream={remoteStream}
          peerUser={activeCallPeer}
          isMicMuted={isMicMuted}
          isCameraOff={isCameraOff}
          isRemoteSpeaking={isRemoteSpeaking}
          onAccept={acceptIncomingCall}
          onReject={rejectIncomingCall}
          onEnd={endCall}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
        />
        {pushToasts.length > 0 && (
          <div className="push-toast-stack">
            {pushToasts.map((toast) => (
              <div key={toast.id} className="push-toast">
                <div className="push-toast-title">{toast.title}</div>
                <div className="push-toast-body">{toast.body}</div>
              </div>
            ))}
          </div>
        )}
        {!selectedChat ? (
          <div className="empty-state">
            <div className="empty-content">
              <h1>SecureChat</h1>
              <p>End-to-end encrypted messaging</p>
              <p className="hint">Select a chat or start a new conversation</p>
            </div>
          </div>
        ) : (
          <div className="chat-container">
            <ChatHeader
              chat={selectedChat}
              currentUserId={user.id}
              online={online}
              onShowInfo={() => setShowInfo(true)}
              onToggleVanish={toggleVanishMode}
              onStartVoiceCall={startVoiceCall}
              onStartVideoCall={startVideoCall}
              callDisabled={isCallBusy || selectedChat?.type !== "direct"}
              showBackButton={isMobileViewport}
              onBackToList={showSidebarPanel}
            />

            {selectedPinnedMessage && (
              <div className="pinned-banner">
                <div className="pinned-label">Pinned</div>
                <div className="pinned-text">{getMessagePreview(selectedPinnedMessage)}</div>
              </div>
            )}

            {selectedMessageIds.length > 0 && (
              <div className="selection-toolbar">
                <div className="selection-text">
                  {selectedMessageIds.length} message{selectedMessageIds.length > 1 ? "s" : ""} selected
                </div>
                <div className="selection-actions">
                  {singleSelectedMessage && (
                    <button className="btn-secondary" onClick={() => startReplyFromSelected(singleSelectedMessage)}>
                      Reply
                    </button>
                  )}
                  {singleSelectedMessage && (
                    <button className="btn-secondary" onClick={() => togglePinSelectedMessage(singleSelectedMessage)}>
                      {String(selectedChat?.pinnedMessageId?._id || selectedChat?.pinnedMessageId) === String(singleSelectedMessage._id)
                        ? "Unpin"
                        : "Pin"}
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => deleteMessageForMe(selectedMessageIds)}>
                    Delete for me
                  </button>
                  {ownSelectedMessageIds.length > 0 && (
                    <button className="btn-primary confirm-danger" onClick={() => deleteMessageForEveryone(ownSelectedMessageIds)}>
                      Delete for everyone
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => setSelectedMessageIds([])}>Cancel</button>
                </div>
              </div>
            )}

            <MessageList
              messages={messages}
              usersById={usersById}
              currentUserId={user.id}
              participantCount={selectedChat?.members?.length || 2}
              typingUsers={typingMap[selectedChatId] || []}
              onDownloadFile={downloadFile}
              onToggleSelectMessage={handleSelectMessage}
              selectedMessageIds={selectedMessageIds}
              rendered={rendered}
              firstUnreadMessageId={firstUnreadMessageId}
              isLoading={messagesLoading}
              onReplyMessage={startReplyFromSelected}
              onDeleteMessage={quickDeleteMessage}
              onEditMessage={startEditMessage}
              onReactMessage={toggleReaction}
              editingMessageId={editingMessageId}
              customEmojis={customEmojis}
              imagePreviewUrls={decryptedImageUrls}
            />

            <MessageInput
              onSendText={sendText}
              onSendFile={sendFile}
              onSaveEdit={saveMessageEdit}
              onTyping={sendTyping}
              vanishMode={Boolean(selectedChat?.vanishMode)}
              replyTarget={
                replyTargetMessage
                  ? {
                      senderName: usersById[replyTargetMessage.senderId]?.name || "User",
                      preview: getMessagePreview(replyTargetMessage)
                    }
                  : null
              }
              onCancelReply={() => setReplyToMessageId(null)}
              editTarget={
                editingTargetMessage
                  ? {
                      messageId: String(editingTargetMessage._id),
                      text:
                        editingTargetMessage.encrypted
                          ? rendered[editingTargetMessage._id] || ""
                          : editingTargetMessage.content || ""
                    }
                  : null
              }
              onCancelEdit={() => setEditingMessageId("")}
              isUploading={isUploadingAttachment}
              uploadProgress={uploadProgress}
            />

            {showInfo && (
              <div className="modal-overlay" onClick={() => setShowInfo(false)}>
                <div className="modal-content chat-info-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2>{getChatTitle(selectedChat)}</h2>
                    <button className="modal-close" onClick={() => setShowInfo(false)}>
                      {"\u2716"}
                    </button>
                  </div>

                  <div className="modal-body">
                    {selectedChat.type === "group" ? (
                      <div className="chat-info-grid">
                        <div className="group-profile-editor">
                          <div className="group-avatar-editor">
                            <div className="group-avatar-preview">
                              {groupAvatarDraftSrc ? (
                                <img src={groupAvatarDraftSrc} alt={groupNameDraft || "Group"} className="avatar-image" />
                              ) : (
                                groupAvatarFallback
                              )}
                            </div>
                            <div className="group-avatar-actions">
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={openGroupAvatarPicker}
                                disabled={!isSelectedGroupAdmin || savingGroupProfile}
                              >
                                Change photo
                              </button>
                              {(groupAvatarUrlDraft || groupAvatarPreviewUrl) && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={removeGroupAvatarDraft}
                                  disabled={!isSelectedGroupAdmin || savingGroupProfile}
                                >
                                  Remove photo
                                </button>
                              )}
                              <input
                                ref={groupAvatarInputRef}
                                type="file"
                                accept="image/*"
                                className="profile-photo-input"
                                onChange={handleGroupAvatarSelected}
                              />
                            </div>
                          </div>

                          <div className="form-group">
                            <label htmlFor="group-name-input">Group Name</label>
                            <input
                              id="group-name-input"
                              type="text"
                              className="form-input"
                              maxLength={80}
                              value={groupNameDraft}
                              onChange={(e) => setGroupNameDraft(e.target.value.slice(0, 80))}
                              disabled={!isSelectedGroupAdmin || savingGroupProfile}
                            />
                          </div>

                          <div className="form-group">
                            <label htmlFor="group-motive-input">Group Motive</label>
                            <textarea
                              id="group-motive-input"
                              className="form-input group-motive-input"
                              maxLength={160}
                              rows={2}
                              placeholder="Set group motive"
                              value={groupMotiveDraft}
                              onChange={(e) => setGroupMotiveDraft(e.target.value.slice(0, 160))}
                              disabled={!isSelectedGroupAdmin || savingGroupProfile}
                            />
                          </div>

                          {isSelectedGroupAdmin ? (
                            <div className="group-save-actions">
                              <button
                                type="button"
                                className="btn-primary"
                                onClick={saveGroupProfile}
                                disabled={savingGroupProfile}
                              >
                                {savingGroupProfile ? "Saving..." : "Save Group Profile"}
                              </button>
                            </div>
                          ) : (
                            <p className="muted-text">Only group admin can edit name, motive and photo.</p>
                          )}
                        </div>

                        <div className="info-row">
                          <span className="info-label">Room ID</span>
                          <span className="info-value">{selectedChat._id}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Created By</span>
                          <span className="info-value">
                            {selectedGroupCreatorName}
                          </span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Created At</span>
                          <span className="info-value">{formatDate(selectedChat.createdAt)}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Members</span>
                          <span className="info-value">{selectedChat.members.length}</span>
                        </div>

                        <div className="members-list compact">
                          {selectedChat.members.map((m) => (
                            <div key={m._id} className="member-pill with-actions">
                              <span>{m.name}</span>
                              <div className="member-pill-actions">
                                <span className="muted">@{m.username}</span>
                                {selectedGroupCreatorId === String(m._id) && (
                                  <span className="member-badge">Admin</span>
                                )}
                                {isSelectedGroupAdmin && String(m._id) !== String(user.id) && (
                                  <button
                                    type="button"
                                    className="member-remove-btn"
                                    onClick={() => removeGroupMember(m)}
                                    disabled={removingMemberId === String(m._id)}
                                  >
                                    {removingMemberId === String(m._id) ? "Removing..." : "Remove"}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="chat-info-grid">
                        <div className="chat-info-profile">
                          <div className="chat-info-profile-avatar">
                            {directChatUserAvatarSrc ? (
                              <img
                                src={directChatUserAvatarSrc}
                                alt={directChatUser?.name || "User"}
                                className="avatar-image"
                              />
                            ) : (
                              directChatUser?.name?.[0]?.toUpperCase() || "?"
                            )}
                          </div>
                        </div>
                        <div className="info-row">
                          <span className="info-label">User</span>
                          <span className="info-value">{directChatUser?.name || "Unknown"}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Username</span>
                          <span className="info-value">
                            @{directChatUser?.username || "unknown"}
                          </span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Status</span>
                          <span className="info-value">
                            {online.includes(directChatUser?._id) ? "Active now" : "Offline"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="modal-footer info-actions">
                    {selectedChat?.type === "direct" && (
                      <button
                        className="btn-primary"
                        onClick={() =>
                          isSelectedChatLocked
                            ? requestUnlockSelectedChat(selectedChat._id)
                            : requestLockSelectedChat(selectedChat._id)
                        }
                        title={isSelectedChatLocked ? "Unlock this chat" : "Set password to make this chat private"}
                      >
                        {isSelectedChatLocked ? "Unlock Chat" : "Lock Chat"}
                      </button>
                    )}
                    <button className="btn-secondary" onClick={() => setShowInfo(false)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
            {popup && (
              <div className="modal-overlay" onClick={() => setPopup(null)}>
                <div className="modal-content confirm-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2>{popup.title}</h2>
                    <button className="modal-close" onClick={() => setPopup(null)}>
                      {"\u2716"}
                    </button>
                  </div>
                  <div className="modal-body">
                    <p>{popup.message}</p>
                  </div>
                  <div className="modal-footer">
                    {popup.type === "confirm" && (
                      <button className="btn-secondary" onClick={() => setPopup(null)}>
                        Cancel
                      </button>
                    )}
                    <button
                      className={popup.danger ? "btn-primary confirm-danger" : "btn-primary"}
                      onClick={async () => {
                        const fn = popup.onConfirm;
                        setPopup(null);
                        if (typeof fn === "function") {
                          await fn();
                        }
                      }}
                    >
                      {popup.type === "confirm" ? popup.confirmText : "OK"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {chatLockPrompt && (
          <div className="modal-overlay" onClick={closeChatLockPrompt}>
            <div className="modal-content chat-lock-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>
                  {chatLockPrompt.mode === "lock"
                    ? "Lock Chat"
                    : chatLockPrompt.mode === "accessLocked"
                    ? "Open Locked Chats"
                    : "Unlock Chat"}
                </h2>
                <button className="modal-close" onClick={closeChatLockPrompt} disabled={chatLockPromptBusy}>
                  {"\u2716"}
                </button>
              </div>
              <form onSubmit={submitChatLockPrompt}>
                <div className="modal-body">
                  <p className="muted-text">
                    {chatLockPrompt.mode === "lock"
                      ? `Set a password for ${chatLockPrompt.chatName || "this chat"}.`
                      : chatLockPrompt.mode === "accessLocked"
                      ? "Enter password to open Locked Chats."
                      : `Enter the password to unlock ${chatLockPrompt.chatName || "this chat"}.`}
                  </p>
                  <div className="form-group">
                    <label htmlFor="chat-lock-password">Password</label>
                    <input
                      id="chat-lock-password"
                      className="form-input"
                      type="password"
                      autoComplete={chatLockPrompt.mode === "lock" ? "new-password" : "current-password"}
                      value={chatLockPassword}
                      onChange={(e) => setChatLockPassword(e.target.value)}
                      disabled={chatLockPromptBusy}
                      autoFocus
                    />
                  </div>
                  {chatLockPromptError ? <div className="error chat-lock-error">{chatLockPromptError}</div> : null}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn-secondary" onClick={closeChatLockPrompt} disabled={chatLockPromptBusy}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={chatLockPromptBusy}>
                    {chatLockPromptBusy
                      ? chatLockPrompt.mode === "lock"
                        ? "Locking..."
                        : chatLockPrompt.mode === "accessLocked"
                        ? "Opening..."
                        : "Unlocking..."
                      : chatLockPrompt.mode === "lock"
                      ? "Lock chat"
                      : chatLockPrompt.mode === "accessLocked"
                      ? "Open Locked Chats"
                      : "Unlock chat"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

