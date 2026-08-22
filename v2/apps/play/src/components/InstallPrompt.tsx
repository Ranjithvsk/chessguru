// Dismissible "Install app" banner. Uses the browser's `beforeinstallprompt`
// event (Chrome/Edge/Samsung); on iOS Safari (which doesn't fire it) we show
// an alt message with "share → add to home screen" hint. Persists dismiss for 30 days.
import { useEffect, useState } from "react";
const DISMISS_KEY = "cg-play-install-dismissed-at";
const DISMISS_TTL = 30 * 86_400_000;

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // Already dismissed recently? Bail.
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (at && Date.now() - at < DISMISS_TTL) return;
    // Already installed? navigator.standalone (iOS) or display-mode standalone.
    if (window.matchMedia?.("(display-mode: standalone)").matches) return;
    if ((navigator as any).standalone) return;

    // iOS Safari — no beforeinstallprompt. Show helper text after 4s.
    const isIosSafari = /iP(hone|ad)/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
    if (isIosSafari) { const t = setTimeout(() => { setIos(true); setShow(true); }, 4000); return () => clearTimeout(t); }

    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;
  const dismiss = () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setShow(false); };
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 rounded-2xl border border-amber-400/40 shadow-2xl p-4"
         style={{ background: "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(251,191,36,0.08))" }}>
      <div className="flex items-start gap-3">
        <div className="text-2xl">📲</div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">Install ChessGuru Play</div>
          <div className="text-xs opacity-80 mt-0.5">
            {ios
              ? "Tap Share ⬆ → Add to Home Screen for one-tap access."
              : "One-tap access, works offline, push alerts for bookmarked tournaments."}
          </div>
          <div className="mt-3 flex gap-2">
            {!ios && <button onClick={install} className="rounded-full px-3 py-1.5 text-xs text-black font-bold" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Install</button>}
            <button onClick={dismiss} className="rounded-full px-3 py-1.5 text-xs opacity-70 hover:opacity-100 border border-white/20">{ios ? "Got it" : "Not now"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
