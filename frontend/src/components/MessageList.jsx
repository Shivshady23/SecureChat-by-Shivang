// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useMemo, useRef, useState } from "react";
import { getAvatarSrc } from "../utils/avatar.js";
import ReactionBar from "./ReactionBar";
const MAX_EDIT_WINDOW_MS = 15 * 60 * 1000;

export default function MessageList({
  messages,
  usersById,
  currentUserId,
  participantCount = 2,
  typingUsers = [],
  onDownloadFile,
  onToggleSelectMessage,
  selectedMessageIds = [],
  rendered,
  firstUnreadMessageId = "",
  isLoading = false,
  onReplyMessage,
  onDeleteMessage,
  onEditMessage,
  onReactMessage,
  editingMessageId = "",
  customEmojis = []
}) {
  const endRef = useRef(null);
  const listRef = useRef(null);
  const unreadMarkerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const holdTimerRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const suppressNextClickRef = useRef(false);
  const lastTapRef = useRef({ messageId: "", at: 0 });
  const [showScrollToUnread, setShowScrollToUnread] = useState(false);
  const [radialMenu, setRadialMenu] = useState(null);
  const [emojiBar, setEmojiBar] = useState(null);

  const customEmojiMap = useMemo(() => {
    const map = new Map();
    for (const emoji of customEmojis || []) {
      const name = String(emoji?.name || "").trim();
      const src = emoji?.skins?.[0]?.src || "";
      if (name && src) {
        map.set(`:${name}:`, src);
      }
    }
    return map;
  }, [customEmojis]);

  const messageById = useMemo(() => {
    const map = {};
    messages.forEach((m) => {
      map[String(m._id)] = m;
    });
    return map;
  }, [messages]);
  const selectedSet = useMemo(() => new Set((selectedMessageIds || []).map(String)), [selectedMessageIds]);

  useEffect(() => {
    if (isLoading) return;
    if (firstUnreadMessageId && unreadMarkerRef.current) {
      unreadMarkerRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [firstUnreadMessageId, isLoading]);

  useEffect(() => {
    if (isLoading) return;
    if (!shouldAutoScrollRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingUsers, isLoading]);

  useEffect(() => {
    const root = listRef.current;
    const marker = unreadMarkerRef.current;
    if (!root || !marker || !firstUnreadMessageId) {
      setShowScrollToUnread(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowScrollToUnread(!entry.isIntersecting);
      },
      { root, threshold: 0.55 }
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [messages, firstUnreadMessageId, isLoading]);

  useEffect(() => {
    const close = () => {
      setRadialMenu(null);
      setEmojiBar(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".message-radial-menu") || target.closest(".message-emoji-bar")) return;
      close();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
  }

  function scrollToUnread() {
    unreadMarkerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const formatTime = (date) => {
    const d = new Date(date);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  };

  const getDateKey = (date) => {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "unknown-day";
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayDiff = Math.round((today - candidate) / (24 * 60 * 60 * 1000));
    if (dayDiff === 0) return "Today";
    if (dayDiff === 1) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  const getMessageReceipt = (msg) => {
    const deliveryCount = (msg.deliveredTo || []).length;
    const readCount = (msg.readBy || []).length;
    const requiredOthers = Math.max(1, participantCount - 1);
    const deliveredToOthers = Math.max(0, deliveryCount - 1);
    const readByOthers = Math.max(0, readCount - 1);

    if (readByOthers >= requiredOthers) {
      return { symbol: "\u2713\u2713", className: "read" };
    }
    if (deliveredToOthers >= requiredOthers) {
      return { symbol: "\u2713\u2713", className: "delivered" };
    }
    return { symbol: "\u2713", className: "sent" };
  };

  function getReplyPreview(msg) {
    const parent = messageById[String(msg.replyTo)];
    if (!parent) return "Original message";
    if (parent.type === "file") return parent.fileName || "File";
    const plain = parent.encrypted ? rendered[parent._id] || "Encrypted message" : parent.content || "";
    return plain || "Message";
  }

  function clearHoldTimer() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function clearHoverTimer() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function clampOverlayPoint(clientX, clientY, type = "radial") {
    if (typeof window === "undefined") {
      return { x: clientX, y: clientY };
    }

    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    if (!viewportWidth || !viewportHeight) {
      return { x: clientX, y: clientY };
    }

    const edgePadding = 16;
    if (type === "emoji") {
      const halfWidth = 146;
      const minX = halfWidth + edgePadding;
      const maxX = viewportWidth - halfWidth - edgePadding;
      const minY = 78;
      const maxY = viewportHeight - 72;
      return {
        x: Math.min(maxX, Math.max(minX, clientX)),
        y: Math.min(maxY, Math.max(minY, clientY))
      };
    }

    const radius = 74;
    const minX = radius + edgePadding;
    const maxX = viewportWidth - radius - edgePadding;
    const minY = radius + edgePadding;
    const maxY = viewportHeight - radius - edgePadding;
    return {
      x: Math.min(maxX, Math.max(minX, clientX)),
      y: Math.min(maxY, Math.max(minY, clientY))
    };
  }

  function openRadialMenu(message, clientX, clientY) {
    const point = clampOverlayPoint(clientX, clientY, "radial");
    setEmojiBar(null);
    setRadialMenu({
      messageId: String(message._id),
      x: point.x,
      y: point.y
    });
  }

  function openEmojiBar(message, clientX, clientY) {
    const point = clampOverlayPoint(clientX, clientY, "emoji");
    setRadialMenu(null);
    setEmojiBar({
      messageId: String(message._id),
      x: point.x,
      y: point.y
    });
  }

  function handleBubbleContextMenu(event, message) {
    event.preventDefault();
    openRadialMenu(message, event.clientX, event.clientY);
  }

  function handleBubbleTouchStart(event, message) {
    if (!event.touches?.length) return;
    const touch = event.touches[0];
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      try {
        navigator.vibrate?.(12);
      } catch {}
      openRadialMenu(message, touch.clientX, touch.clientY);
    }, 420);
  }

  function handleBubbleTouchEnd(message) {
    clearHoldTimer();
    const now = Date.now();
    const messageId = String(message._id);
    const previous = lastTapRef.current;
    if (previous.messageId === messageId && now - previous.at < 280) {
      try {
        navigator.vibrate?.(8);
      } catch {}
      suppressNextClickRef.current = true;
      onReactMessage?.(message, "\u2764\uFE0F");
      lastTapRef.current = { messageId: "", at: 0 };
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 240);
      return;
    }
    lastTapRef.current = { messageId, at: now };
  }

  function canEditMessage(msg) {
    if (!msg?._id) return false;
    if (String(msg.senderId) !== String(currentUserId)) return false;
    if (msg.type !== "text") return false;
    const createdAtMs = new Date(msg.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) return false;
    return Date.now() - createdAtMs <= MAX_EDIT_WINDOW_MS;
  }

  function isBigEmojiText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (/\s/.test(text)) return false;
    const parts = Array.from(text.matchAll(/(\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu)).map((entry) => entry[0]);
    if (!parts.length || parts.length > 3) return false;
    const rebuilt = parts.join("");
    return rebuilt === text;
  }

  function renderReactionEmoji(emoji) {
    const value = String(emoji || "");
    const customSrc = customEmojiMap.get(value);
    if (customSrc) {
      return <img src={customSrc} alt={value} className="reaction-custom-image" />;
    }
    return value;
  }

  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentKey = "";
    messages.forEach((msg, index) => {
      const key = getDateKey(msg.createdAt);
      if (key !== currentKey) {
        currentKey = key;
        groups.push({
          key,
          label: formatDate(msg.createdAt),
          items: []
        });
      }
      groups[groups.length - 1].items.push({ msg, index });
    });
    return groups;
  }, [messages]);

  const radialMessage = radialMenu ? messageById[String(radialMenu.messageId)] : null;
  const emojiTargetMessage = emojiBar ? messageById[String(emojiBar.messageId)] : null;

  if (isLoading) {
    return (
      <div className="message-list" ref={listRef}>
        <div className="message-skeleton-list">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className={`message-skeleton-row ${index % 3 === 0 ? "own" : "other"}`}>
              <div className="message-skeleton-avatar" />
              <div className="message-skeleton-bubble">
                <div className="message-skeleton-line short" />
                <div className="message-skeleton-line" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="message-list" ref={listRef} onScroll={handleScroll}>
      {groupedMessages.map((group) => (
        <section key={group.key} className="message-day-group">
          <div className="date-separator">
            <span>{group.label}</span>
          </div>
          {group.items.map(({ msg, index }) => {
            const msgId = String(msg._id);
            const isOwn = String(msg.senderId) === String(currentUserId);
            const sender = usersById[msg.senderId];
            const senderAvatarSrc = getAvatarSrc(sender?.avatarUrl);
            const receipt = getMessageReceipt(msg);
            const isSelected = selectedSet.has(msgId);
            const prevMsg = messages[index - 1];
            const nextMsg = messages[index + 1];
            const sameDateAsPrev = prevMsg && getDateKey(prevMsg.createdAt) === group.key;
            const sameDateAsNext = nextMsg && getDateKey(nextMsg.createdAt) === group.key;
            const closeToPrev =
              prevMsg &&
              String(prevMsg.senderId) === String(msg.senderId) &&
              sameDateAsPrev &&
              new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < 5 * 60 * 1000;
            const closeToNext =
              nextMsg &&
              String(nextMsg.senderId) === String(msg.senderId) &&
              sameDateAsNext &&
              new Date(nextMsg.createdAt).getTime() - new Date(msg.createdAt).getTime() < 5 * 60 * 1000;
            const isClusterStart = !closeToPrev;
            const isClusterEnd = !closeToNext;
            const isEditingThisMessage = editingMessageId && String(editingMessageId) === msgId;
            const resolvedText = rendered[msg._id] || (!msg.encrypted ? msg.content : "...");
            const reactionsMap = new Map();
            for (const entry of msg.reactions || []) {
              if (!entry) continue;
              const reactionEmoji = String(entry.emoji || "");
              if (!reactionEmoji) continue;

              // Supports both legacy format { emoji, userIds[] } and new format { user, emoji }.
              if (Array.isArray(entry.userIds)) {
                for (const rawUserId of entry.userIds) {
                  const userId = String(rawUserId || "");
                  if (!userId) continue;
                  if (!reactionsMap.has(reactionEmoji)) {
                    reactionsMap.set(reactionEmoji, new Set());
                  }
                  reactionsMap.get(reactionEmoji).add(userId);
                }
              } else {
                const userId = String(entry.user || "");
                if (!userId) continue;
                if (!reactionsMap.has(reactionEmoji)) {
                  reactionsMap.set(reactionEmoji, new Set());
                }
                reactionsMap.get(reactionEmoji).add(userId);
              }
            }

            const reactions = Array.from(reactionsMap.entries()).map(([emoji, userIdsSet]) => {
              const userIds = Array.from(userIdsSet);
              return {
                emoji,
                userIds,
                count: userIds.length,
                reactedByMe: userIds.includes(String(currentUserId))
              };
            });

            return (
              <div key={msgId}>
                {msgId === String(firstUnreadMessageId) && (
                  <div ref={unreadMarkerRef} className="new-messages-divider">
                    <span>New messages</span>
                  </div>
                )}
                <div className={`message-row ${isOwn ? "own" : "other"} ${isClusterStart ? "cluster-start" : ""} ${isClusterEnd ? "cluster-end" : ""}`}>
                  {!isOwn && (
                    <div className="message-avatar">
                      {senderAvatarSrc ? (
                        <img src={senderAvatarSrc} alt={sender?.name || "User"} className="avatar-image" />
                      ) : (
                        sender?.name?.[0]?.toUpperCase() || "?"
                      )}
                    </div>
                  )}

                  <div
                    role="button"
                    tabIndex={0}
                    className={`message-bubble ${msg.type} ${isSelected ? "selected" : ""} ${isClusterEnd ? "with-tail" : ""} ${
                      isEditingThisMessage ? "editing" : ""
                    } animate-entry`}
                    onClick={() => {
                      if (suppressNextClickRef.current) return;
                      onToggleSelectMessage?.(msg);
                    }}
                    onDoubleClick={() => onReactMessage?.(msg, "\u2764\uFE0F")}
                    onContextMenu={(event) => handleBubbleContextMenu(event, msg)}
                    onMouseEnter={(event) => {
                      if (typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches) {
                        clearHoverTimer();
                        const target = event.currentTarget;
                        hoverTimerRef.current = setTimeout(() => {
                          const rect = target.getBoundingClientRect();
                          openEmojiBar(msg, rect.left + rect.width / 2, rect.top + 8);
                        }, 260);
                      }
                    }}
                    onMouseLeave={() => clearHoverTimer()}
                    onTouchStart={(event) => handleBubbleTouchStart(event, msg)}
                    onTouchEnd={() => handleBubbleTouchEnd(msg)}
                    onTouchCancel={clearHoldTimer}
                    onTouchMove={clearHoldTimer}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onToggleSelectMessage?.(msg);
                      }
                    }}
                    title="Tap to select, hold for quick actions"
                  >
                    {!isOwn && isClusterStart && <div className="message-sender-name">{sender?.name || "User"}</div>}
                    {msg.replyTo && (
                      <div className="reply-preview">
                        <span className="reply-label">Reply</span>
                        <span className="reply-text">{getReplyPreview(msg)}</span>
                      </div>
                    )}

                    {msg.type === "text" ? (
                      <div className={`message-text ${isBigEmojiText(resolvedText) ? "message-text-big-emoji" : ""}`}>{resolvedText}</div>
                    ) : (
                      <div className="message-file">
                        <span className="file-label">{"\uD83D\uDCCE"} {msg.fileName || "File"}</span>
                        <button
                          type="button"
                          className="file-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDownloadFile(msg);
                          }}
                        >
                          Download
                        </button>
                      </div>
                    )}

                    {reactions.length > 0 && (
                      <div className="message-reactions">
                        {reactions.map((reaction) => (
                          <button
                            key={`${msgId}-${reaction.emoji}`}
                            type="button"
                            className={`message-reaction-chip ${reaction.reactedByMe ? "active" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onReactMessage?.(msg, reaction.emoji);
                            }}
                            title={reaction.userIds.map((userId) => usersById[userId]?.name || "User").join(", ")}
                          >
                            <span>{renderReactionEmoji(reaction.emoji)}</span>
                            <span>{reaction.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="message-time">
                      {msg.editedAt ? <span className="edited-label">edited</span> : null}
                      <span title={new Date(msg.createdAt).toLocaleString()}>{formatTime(msg.createdAt)}</span>{" "}
                      {isOwn && (
                        <span className={`read-indicator ${receipt.className}`}>
                          {receipt.symbol}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {typingUsers.length > 0 && (
        <div className="message-row other">
          <div className="message-avatar">...</div>
          <div className="message-bubble typing">
            <div className="typing-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      {radialMenu && radialMessage && (
        <div className="message-radial-overlay">
          <div className="message-radial-menu" style={{ left: radialMenu.x, top: radialMenu.y }}>
            <button
              type="button"
              className="radial-action radial-reply"
              onClick={() => {
                onReplyMessage?.(radialMessage);
                setRadialMenu(null);
              }}
              title="Reply"
            >
              {"\u21A9"}
            </button>
            <button
              type="button"
              className="radial-action radial-react"
              onClick={() => {
                openEmojiBar(radialMessage, radialMenu.x, radialMenu.y);
              }}
              title="React"
            >
              {"\uD83D\uDE03"}
            </button>
            <button
              type="button"
              className="radial-action radial-edit"
              onClick={() => {
                onEditMessage?.(radialMessage);
                setRadialMenu(null);
              }}
              title={canEditMessage(radialMessage) ? "Edit" : "Edit available for 15 minutes after sending"}
              disabled={
                !canEditMessage(radialMessage)
              }
            >
              {"\u270E"}
            </button>
            <button
              type="button"
              className="radial-action radial-delete"
              onClick={() => {
                onDeleteMessage?.(radialMessage);
                setRadialMenu(null);
              }}
              title="Delete"
            >
              {"\uD83D\uDDD1\uFE0F"}
            </button>
          </div>
        </div>
      )}

      {emojiBar && emojiTargetMessage && (
        <ReactionBar
          style={{ left: emojiBar.x, top: emojiBar.y }}
          onReact={(emoji) => {
            onReactMessage?.(emojiTargetMessage, emoji);
            setEmojiBar(null);
          }}
        />
      )}

      {showScrollToUnread && firstUnreadMessageId && (
        <button type="button" className="scroll-unread-btn" onClick={scrollToUnread}>
          New messages
        </button>
      )}

      <div ref={endRef} />
    </div>
  );
}

