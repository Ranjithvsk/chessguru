// ClassAlertsPrompt — a one-time "Turn on class alerts" ask for students (owner ask 2026-09-18).
//
// Why: coach Raagul's 20:02 class reached nobody. The audience invite goes out as Web Push, and
// not ONE student in the system had a subscription — LiveClassBanner asked for *permission* on
// page load (no gesture, and permission alone subscribes nothing) and the only subscribe control
// was a toggle buried on the Dashboard. This puts the ask where students land, runs the subscribe
// from their tap (browsers only show the permission prompt for a user gesture), and asks once per
// device: answered → never again here (the Dashboard toggle remains for changing their mind).
//
// Hidden when: not a student, push unsupported (except iPhone Safari, see below), permission
// blocked, already subscribed, inside a class room, or on login/marketing pages.
// iPhone: Safari only delivers web push to an app on the Home Screen, so a browser tab gets the
// two-step explanation instead of a button. The installed app has its own storage, so the real
// prompt appears there fresh.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import * as push from "../lib/push";

const DONE_KEY = "cg_class_alerts_prompt_v1"; // "on" | "later" | "ios-seen"

function iosBrowserTab(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function readDone(): string | null { try { return localStorage.getItem(DONE_KEY); } catch { return null; } }

export default function ClassAlertsPrompt() {
  const loc = useLocation();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const student = !!auth?.loggedIn && auth.role === "student";
  const [done, setDone] = useState<string | null>(readDone);
  const [st, setSt] = useState<push.PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!student || done) return;
    let cancelled = false;
    push.status()
      .then((s) => { if (!cancelled) setSt(s); })
      .catch(() => { if (!cancelled) setSt({ supported: false, permission: "unsupported", subscribed: false }); });
    return () => { cancelled = true; };
  }, [student, done]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  const mark = (v: string) => { try { localStorage.setItem(DONE_KEY, v); } catch { /* */ } setDone(v); };

  if (flash) {
    return (
      <div className="mb-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100">
        ✓ {flash}
      </div>
    );
  }
  if (!student || done || !st) return null;
  const p = loc.pathname;
  if (p.startsWith("/class") || p.startsWith("/login") || p.startsWith("/signup")) return null;
  const ios = iosBrowserTab();
  if (st.supported) {
    if (st.subscribed || st.permission === "denied") return null;
  } else if (!ios) {
    return null;
  }

  const turnOn = async () => {
    setBusy(true); setNote(null);
    try {
      // enable() waits for the service worker; cap it so a browser that never registers one
      // can't leave the button spinning forever.
      const next = await Promise.race([
        push.enable(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("took too long")), 20000)),
      ]);
      if (next.subscribed) {
        mark("on");
        setFlash("Class alerts are on — you'll get a ping the moment your coach starts a class.");
      } else if (next.permission === "denied") {
        setNote("Notifications are blocked for this site in your browser settings.");
        mark("later");
      } else {
        // The browser prompt was dismissed without an answer — leave the ask up for one more tap.
        setNote("No permission was given. Tap Turn on again and choose Allow.");
      }
    } catch (e) {
      setNote(`Couldn't turn on alerts (${e instanceof Error ? e.message : String(e)}). You can try later from your Dashboard.`);
      mark("later");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-sky-400/40 bg-gradient-to-r from-sky-500/15 via-indigo-500/10 to-sky-500/15 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden>🔔</span>
        <div>
          <div className="font-semibold text-sky-900 dark:text-sky-100">
            {ios ? "Get a ping when your class starts" : "Turn on class alerts?"}
          </div>
          <div className="text-xs text-sky-800/80 dark:text-sky-200/70">
            {ios
              ? "On iPhone: tap Share, choose “Add to Home Screen”, open ChessGuru from there, then turn on alerts."
              : "Your phone pings the moment your coach starts a class — even when ChessGuru is closed."}
          </div>
          {note && <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{note}</div>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        {ios ? (
          <button type="button" onClick={() => mark("ios-seen")}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">
            Got it
          </button>
        ) : (
          <>
            <button type="button" onClick={() => mark("later")} disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-sky-900/80 hover:bg-sky-500/10 dark:text-sky-200/80">
              Not now
            </button>
            <button type="button" onClick={turnOn} disabled={busy}
              className={`rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 ${busy ? "opacity-60" : ""}`}>
              {busy ? "Turning on…" : "Turn on class alerts"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
