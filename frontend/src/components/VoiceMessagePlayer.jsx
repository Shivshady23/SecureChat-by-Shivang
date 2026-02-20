// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useEffect, useMemo, useRef, useState } from "react";
import { AiFillPlayCircle, AiOutlineLoading3Quarters, AiOutlinePauseCircle } from "react-icons/ai";
import { API_BASE } from "../services/api.js";
import { getToken } from "../services/storage.js";

const PLAYBACK_SPEEDS = [1, 1.5, 2];
let activeAudioElement = null;

function formatDuration(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function appendVoiceToken(rawUrl, token) {
  if (!rawUrl) return "";
  try {
    const absolute = new URL(rawUrl, API_BASE);
    if (token && absolute.pathname.includes("/api/upload-voice/")) {
      absolute.searchParams.set("token", token);
    }
    return absolute.toString();
  } catch {
    return rawUrl;
  }
}

function resolveVoiceSource(message, token) {
  const raw = String(message?.fileUrl || message?.content || "").trim();
  const fileKey = String(message?.fileKey || "").trim();

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return appendVoiceToken(raw, token);
  }
  if (raw.startsWith("blob:")) {
    return raw;
  }
  if (raw.startsWith("/api/upload-voice/")) {
    return appendVoiceToken(`${API_BASE}${raw}`, token);
  }
  if (raw.startsWith("/uploads/voice/")) {
    const key = raw.split("/").filter(Boolean).pop() || fileKey;
    if (key) return appendVoiceToken(`${API_BASE}/api/upload-voice/${encodeURIComponent(key)}`, token);
  }
  if (raw.startsWith("/uploads/")) {
    return `${API_BASE}${raw}`;
  }
  if (fileKey) {
    return appendVoiceToken(`${API_BASE}/api/upload-voice/${encodeURIComponent(fileKey)}`, token);
  }
  return "";
}

export default function VoiceMessagePlayer({ message, isOwn = false }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number(message?.duration || 0));
  const [speedIndex, setSpeedIndex] = useState(0);
  const [errorText, setErrorText] = useState("");
  const token = getToken();

  const sourceUrl = useMemo(
    () => resolveVoiceSource(message, token),
    [message?._id, message?.fileKey, message?.fileUrl, message?.content, token]
  );

  const playbackRate = PLAYBACK_SPEEDS[speedIndex];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      const measured = Number(audio.duration);
      if (Number.isFinite(measured) && measured > 0) {
        setDuration(measured);
      } else {
        setDuration(Number(message?.duration || 0));
      }
      setIsLoading(false);
      setIsBuffering(false);
    };
    const onCanPlay = () => {
      setIsLoading(false);
      setIsBuffering(false);
    };
    const onWaiting = () => {
      setIsBuffering(true);
    };
    const onPlaying = () => {
      if (activeAudioElement && activeAudioElement !== audio) {
        try {
          activeAudioElement.pause();
        } catch {}
      }
      activeAudioElement = audio;
      setIsPlaying(true);
      setIsLoading(false);
      setIsBuffering(false);
    };
    const onPause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
    };
    const onTimeUpdate = () => {
      setCurrentTime(Number(audio.currentTime || 0));
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
    };
    const onError = () => {
      setIsPlaying(false);
      setIsLoading(false);
      setIsBuffering(false);
      setErrorText("Unable to play voice message.");
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      if (activeAudioElement === audio) {
        activeAudioElement = null;
      }
    };
  }, [message?._id, message?.duration]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(Number(message?.duration || 0));
    setIsPlaying(false);
    setIsLoading(true);
    setIsBuffering(false);
    setErrorText("");
    setSpeedIndex(0);
  }, [message?._id, sourceUrl, message?.duration]);

  async function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio || !sourceUrl) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      setErrorText("");
      if (audio.readyState < 2) setIsLoading(true);
      if (activeAudioElement && activeAudioElement !== audio) {
        activeAudioElement.pause();
      }
      await audio.play();
    } catch (err) {
      setIsLoading(false);
      setIsBuffering(false);
      setErrorText(err?.message || "Unable to play voice message.");
    }
  }

  function handleSeek(event) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(event.target.value || 0);
    if (!Number.isFinite(next)) return;
    audio.currentTime = next;
    setCurrentTime(next);
  }

  function cycleSpeed() {
    setSpeedIndex((prev) => (prev + 1) % PLAYBACK_SPEEDS.length);
  }

  const effectiveDuration = Math.max(
    1,
    Number.isFinite(duration) && duration > 0 ? duration : Number(message?.duration || 1)
  );
  const sliderMax = Number.isFinite(effectiveDuration) ? effectiveDuration : 1;
  const sliderValue = Math.min(sliderMax, Math.max(0, currentTime));

  return (
    <div className={`voice-message-ui ${isOwn ? "own" : "other"} ${isPlaying ? "is-playing" : ""}`}>
      <audio ref={audioRef} src={sourceUrl} preload="metadata" />
      <button
        type="button"
        className="voice-play-btn"
        onClick={togglePlayPause}
        disabled={!sourceUrl || (isLoading && !isPlaying)}
        title={isPlaying ? "Pause voice message" : "Play voice message"}
        aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
      >
        {isLoading && !isPlaying ? (
          <AiOutlineLoading3Quarters className="voice-spinner" />
        ) : isPlaying ? (
          <AiOutlinePauseCircle />
        ) : (
          <AiFillPlayCircle />
        )}
      </button>

      <div className="voice-player-body">
        <div className="voice-waveform" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => (
            <span
              key={`voice-bar-${index}`}
              className={`voice-bar ${isPlaying ? "active" : ""}`}
              style={{ animationDelay: `${index * 0.05}s` }}
            />
          ))}
        </div>

        <input
          type="range"
          className="voice-slider"
          min={0}
          max={sliderMax}
          step={0.1}
          value={sliderValue}
          onChange={handleSeek}
          aria-label="Voice message seek bar"
        />

        <div className="voice-meta-row">
          <span className="voice-time-text">
            {formatDuration(currentTime)} / {formatDuration(effectiveDuration)}
          </span>
          <button
            type="button"
            className="voice-speed-btn"
            onClick={cycleSpeed}
            aria-label="Change playback speed"
            title="Change playback speed"
          >
            {playbackRate}x
          </button>
        </div>

        {isBuffering && <div className="voice-buffering">Buffering...</div>}
        {errorText && <div className="voice-error">{errorText}</div>}
      </div>
    </div>
  );
}
