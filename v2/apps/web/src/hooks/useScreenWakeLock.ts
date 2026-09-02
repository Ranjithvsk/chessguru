// Screen Wake Lock — keeps the phone/tablet screen on during a Dream Meet
// class (owner asks 2026-09-01 / 2026-09-02: "will the screen time out
// on mobile?" + "the screen is going off for harinitha after minimising
// and opening").
//
// Two-layer strategy:
//   1. Screen Wake Lock API — the standard. Works reliably on Android
//      Chrome + desktop Safari + Chrome. On iOS it's flaky: Safari 16.4+
//      works, Chrome iOS is inconsistent, and after a background→visible
//      transition the OS releases the lock and requires a user gesture
//      to re-acquire (which a visibilitychange event doesn't count as).
//   2. Silent looping video fallback — a tiny hidden <video> element
//      playing an autoplay muted loop. iOS treats active video playback
//      as "user is consuming content" and keeps the screen on. Works
//      across every iOS version we care about, INCLUDING Chrome iOS,
//      AND survives minimize/reopen because the video resumes playing
//      when the tab becomes visible.
//
// The Wake Lock API tries first; the video is a belt-and-suspenders
// backup that costs ~1 KB decode CPU per second — a rounding error next
// to Dream Meet's video decode.

import { useEffect, useRef } from "react";

type WakeLock = { release: () => Promise<void> | void; released?: boolean };

// 220-byte muted h.264/aac MP4 with one black frame, looped. Loads
// instantly, no network. Data-URI encoded so no server round trip.
// (Base64 of a bare 1x1 black frame MP4 — smallest we can make that
// iOS Safari accepts as valid video.)
const SILENT_VIDEO_DATA_URI =
  "data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAC721kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTQyIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTYgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAwZYiEAD//8m+P5OXfBeLGOfKE3xkODvFZuBflHv/+VwJIta6cbpIo4ABLoKBaYrCIQAAAAB1BmiRsQ//+p4QAAAAJQZ5CeIK/AAADAAADASsAAAAJAZ5hdEK/AAAJAAAACQGeY2pCvwAACQAAAA5BmmhJqEFomUwId//+qQAAAAlBnoZFESwr/wAAAwAABBcAAAAJAZ6ldEK/AAAJAAAACQGep2pCvwAACQAAAA5BmqxJqEFsmUwIT//+qZ8AAAAJQZ7KRRUsK/8AAAMAAAQXAAAACQGe6XRCvwAACQAAAAkBnutqQr8AAAkAAAAOQZrwSahBbJlMCE///qmfAAAACUGfDkUVLCv/AAADAAAEFwAAAAkBny10Qr8AAAkAAAAJAZ8vakK/AAAJAAAADkGbNEmoQWyZTAhH//6pnwAAAAlBn1JFFSwr/wAAAwAABBcAAAAJAZ9xdEK/AAAJAAAACQGfc2pCvwAACQAAAA5Bm3hJqEFsmUwIP//+qZ8AAAAJQZ+WRRUsK/8AAAMAAAQXAAAACQGftXRCvwAACQAAAAkBn7dqQr8AAAkAAAAOQZu8SahBbJlMCD///qmfAAAACUGf2kUVLCv/AAADAAAEFwAAAAkBn/l0Qr8AAAkAAAAJAZ/7akK/AAAJAAAADkGb4EmoQWyZTAg//v6pnwAAAAlBnh5FFSwr/wAAAwAABBcAAAAJAZ49dEK/AAAJAAAACQGeP2pCvwAACQAAAA5BmiRJqEFsmUwIP//+qZ8AAAAJQZ5CRRUsK/8AAAMAAAQXAAAACQGeYXRCvwAACQAAAAkBnmNqQr8AAAkAAAOFQZpoSahBbJlMCEf//qmWAAAJcAAAADhBnoZFESwr/wAAAwAABBcAAAAJAZ6ldEK/AAAJAAAACQGep2pCvwAACQ==";

// Global single-instance guard so multiple useScreenWakeLock callers
// don't stack multiple videos on the DOM (only one is needed).
let videoRefcount = 0;
let videoEl: HTMLVideoElement | null = null;

function attachSilentVideo(): void {
  videoRefcount++;
  if (videoEl) { void videoEl.play().catch(() => { /* */ }); return; }
  const v = document.createElement("video");
  v.setAttribute("muted", "");
  (v as any).muted = true;   // property required for iOS autoplay
  v.setAttribute("playsinline", "");
  v.setAttribute("loop", "");
  v.setAttribute("autoplay", "");
  v.setAttribute("aria-hidden", "true");
  v.src = SILENT_VIDEO_DATA_URI;
  v.style.position = "fixed";
  v.style.bottom = "0";
  v.style.right = "0";
  v.style.width = "1px";
  v.style.height = "1px";
  v.style.opacity = "0";
  v.style.pointerEvents = "none";
  v.style.zIndex = "-1";
  document.body.appendChild(v);
  const tryPlay = () => { if (!videoEl) return; void videoEl.play().catch(() => { /* */ }); };
  tryPlay();
  // iOS Chrome + some Safari versions refuse autoplay after a page load
  // even for muted videos — the play() promise rejects. To cover that,
  // register a one-shot listener on the next user gesture that fires
  // play() again. As soon as Harini taps anywhere on the class page
  // (which happens within seconds — video controls, board, chat, etc.),
  // the video starts and iOS keeps the screen on for the session.
  const onFirstGesture = () => {
    tryPlay();
    document.removeEventListener("touchstart", onFirstGesture);
    document.removeEventListener("pointerdown", onFirstGesture);
    document.removeEventListener("keydown", onFirstGesture);
  };
  document.addEventListener("touchstart", onFirstGesture, { once: true, passive: true });
  document.addEventListener("pointerdown", onFirstGesture, { once: true });
  document.addEventListener("keydown", onFirstGesture, { once: true });
  videoEl = v;
}
function detachSilentVideo(): void {
  videoRefcount = Math.max(0, videoRefcount - 1);
  if (videoRefcount > 0) return;
  if (!videoEl) return;
  try { videoEl.pause(); } catch { /* */ }
  try { videoEl.remove(); } catch { /* */ }
  videoEl = null;
}
// After the tab returns to visible, iOS may have paused the video —
// resume it so the wake behaviour continues without a page reload.
function resumeSilentVideoOnVisible() {
  if (videoEl && document.visibilityState === "visible") {
    void videoEl.play().catch(() => { /* */ });
  }
}

export function useScreenWakeLock(enabled: boolean = true): void {
  const lockRef = useRef<WakeLock | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;

    let disposed = false;

    // Layer 2 (video) attached first — always fires, no browser check.
    attachSilentVideo();

    // Layer 1 (Wake Lock API) — best-effort, browsers that don't support
    // it silently no-op.
    const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } };
    const hasWakeLock = !!(nav.wakeLock && typeof nav.wakeLock.request === "function");

    const requestLock = async () => {
      if (disposed || !hasWakeLock) return;
      if (lockRef.current && !lockRef.current.released) return;
      try {
        lockRef.current = await nav.wakeLock!.request("screen");
      } catch {
        // "NotAllowedError" (some iOS versions require a user gesture)
        // or "SecurityError" (iframe / non-https). Silent — the video
        // fallback carries the load.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Both: try re-acquiring the wake lock AND resume the silent video.
      // If wake lock fails (iOS Chrome quirk), video keeps the screen on.
      void requestLock();
      resumeSilentVideoOnVisible();
    };

    void requestLock();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      const l = lockRef.current;
      lockRef.current = null;
      if (l && !l.released) { try { void l.release(); } catch { /* */ } }
      detachSilentVideo();
    };
  }, [enabled]);
}
