// Student self-enrolls their face for attendance check-in.
//
// Flow:
//   1. Consent gate — plain-English notice + checkbox.
//   2. Camera preview + face-api.js loads on demand (~7MB from CDN).
//   3. Liveness challenge (blink + smile) — proves it's a live person,
//      not a photo held up to the camera.
//   4. Multi-pose capture — 5 shots: front + slight left + slight right
//      + smile + neutral. Each yields one 128-dim descriptor.
//   5. Upload all descriptors + liveness attestation to server.
//   6. Re-enroll button on top — deletes current enrollment then restarts.
//
// Never uploads photos, only descriptors (128 floats each). Owner ask
// 2026-08-23. Route: /settings/face.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { loadExpressionNet, detectFaceRich } from "../lib/faceApi";

type Step = "consent" | "loading-models" | "camera-permission" | "liveness" | "capture" | "review" | "uploading" | "done" | "error";

type EnrolledInfo = { studentId: string; name: string; enrolledAt: string | null };

const CAPTURE_TARGETS = [
  { key: "front",  label: "Look straight at the camera",     hint: "Neutral expression" },
  { key: "left",   label: "Turn slightly to your LEFT",       hint: "Chin over left shoulder" },
  { key: "right",  label: "Turn slightly to your RIGHT",      hint: "Chin over right shoulder" },
  { key: "smile",  label: "Big smile 😄",                     hint: "Look straight, smile wide" },
  { key: "neutral",label: "One more neutral pose",            hint: "Straight ahead, relaxed" },
];

export default function FaceEnrollPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const rosterQ = useQuery({
    queryKey: ["face-roster-self"],
    queryFn: async () => {
      const r = await fetch(`${(import.meta as any).env?.VITE_API_BASE ?? ""}/api/academy/attendance/face/roster`, { credentials: "include" });
      if (!r.ok) return null;
      return await r.json() as { ok: boolean; rows: EnrolledInfo[] };
    },
    enabled: !!auth?.loggedIn,
    staleTime: 30_000,
  });
  const alreadyEnrolled = rosterQ.data?.rows?.find((r) => r.studentId === auth?.userId)?.enrolledAt ?? null;

  const [step, setStep] = useState<Step>(alreadyEnrolled ? "done" : "consent");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [captures, setCaptures] = useState<Array<{ key: string; descriptor: Float32Array }>>([]);
  const [liveness, setLiveness] = useState<{ blinked: boolean; smiled: boolean; method: string }>({ blinked: false, smiled: false, method: "" });
  const [captureIdx, setCaptureIdx] = useState(0);
  const [detectMsg, setDetectMsg] = useState<string>("");

  // Sync step when roster loads and we discover an existing enrollment
  useEffect(() => {
    if (alreadyEnrolled && step === "consent") setStep("done");
  }, [alreadyEnrolled, step]);

  // Camera stream lifecycle — bind to <video> whenever we enter a step that
  // needs the camera. Stop the stream on unmount / step change.
  useEffect(() => {
    const wantsCamera = step === "liveness" || step === "capture";
    if (!wantsCamera) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        setError(e?.message || "Could not access camera. Please grant permission and reload.");
        setStep("error");
      }
    })();
    return () => { cancelled = true; };
  }, [step]);

  // Liveness loop — detect blink (EAR drop) + smile (>0.7 happy). Runs
  // ~5 fps to stay light on CPU. Ends when both challenges pass.
  useEffect(() => {
    if (step !== "liveness" || !videoRef.current) return;
    let cancelled = false;
    let baselineEar = 0.35;   // typical open-eye EAR; adjusts as we sample
    let sampleCount = 0;
    const tick = async () => {
      if (cancelled || step !== "liveness") return;
      try {
        const r = await detectFaceRich(videoRef.current!);
        if (r) {
          // Update baseline in first 5 frames (assume eyes open)
          if (sampleCount < 5) {
            baselineEar = (baselineEar * sampleCount + r.ear) / (sampleCount + 1);
            sampleCount++;
          }
          const blinkThreshold = baselineEar * 0.7;   // 30% drop = blink
          const blinked = r.ear < blinkThreshold;
          const smiled = r.smile > 0.7;
          setDetectMsg(`EAR ${r.ear.toFixed(2)} · smile ${(r.smile * 100).toFixed(0)}%`);
          setLiveness((prev) => {
            const next = { ...prev };
            if (blinked && !prev.blinked) next.blinked = true;
            if (smiled && !prev.smiled) next.smiled = true;
            if (next.blinked && next.smiled) next.method = "blink+smile";
            return next;
          });
        } else {
          setDetectMsg("No face detected — center yourself in the frame");
        }
      } catch { /* ignore transient detection errors */ }
      setTimeout(tick, 200);
    };
    (async () => {
      try { await loadExpressionNet(); tick(); }
      catch (e: any) { setError(e?.message || "Face models failed to load."); setStep("error"); }
    })();
    return () => { cancelled = true; };
  }, [step]);

  // When both challenges pass, advance to capture step automatically.
  useEffect(() => {
    if (step === "liveness" && liveness.blinked && liveness.smiled) {
      const t = setTimeout(() => setStep("capture"), 800);
      return () => clearTimeout(t);
    }
  }, [step, liveness]);

  const takeShot = async () => {
    if (!videoRef.current) return;
    try {
      const r = await detectFaceRich(videoRef.current);
      if (!r) { setError("No face detected — center yourself and try again."); return; }
      setCaptures((prev) => [...prev, { key: CAPTURE_TARGETS[captureIdx]!.key, descriptor: r.descriptor }]);
      setError(null);
      if (captureIdx + 1 < CAPTURE_TARGETS.length) {
        setCaptureIdx(captureIdx + 1);
      } else {
        setStep("review");
      }
    } catch (e: any) {
      setError(e?.message || "Detection failed. Try again.");
    }
  };

  const enrollMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; enrolledCount?: number }>("/api/academy/attendance/face/enroll", {
      descriptors: captures.map((c) => Array.from(c.descriptor)),
      consent: true,
      livenessPassed: liveness.blinked && liveness.smiled,
      livenessMethod: liveness.method || "none",
    }),
    onSuccess: (res) => {
      if (res.ok) setStep("done"); else { setError(res.error || "Enrollment failed."); setStep("error"); }
    },
    onError: (e: any) => { setError(e?.message || "Enrollment request failed."); setStep("error"); },
  });

  const deleteMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string }>("/api/academy/attendance/face/delete", {}),
    onSuccess: (res) => {
      if (res.ok) {
        setCaptures([]); setCaptureIdx(0); setLiveness({ blinked: false, smiled: false, method: "" });
        setStep("consent"); rosterQ.refetch();
      } else setError(res.error || "Delete failed.");
    },
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/settings/face" replace />;

  return (
    <div className="mx-auto max-w-lg px-3 py-6">
      <div className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-400">Settings · attendance</div>
        <h1 className="mt-1 font-display text-2xl text-white">👤 Face check-in enrollment</h1>
        <p className="mt-1 text-sm text-ink-400">One-time setup. After this, walking past your coach's camera marks you present automatically.</p>
      </div>

      {step === "consent" && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-5 space-y-4">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 text-sm text-sky-100">
            <b className="text-white">What we store:</b> a 128-number "fingerprint" of your face (not a photo). Original camera frames never leave your device.<br />
            <b className="text-white">What we don't do:</b> upload photos, share your face data with anyone, or use it outside attendance.
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-200">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>I understand and consent to face-based attendance check-in.</span>
          </label>
          <div className="flex justify-end gap-2">
            <Link to="/dashboard" className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-white">Cancel</Link>
            <button type="button" disabled={!consent} onClick={() => setStep("liveness")}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40">
              Continue →
            </button>
          </div>
        </div>
      )}

      {step === "liveness" && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-5 space-y-4">
          <div className="text-center">
            <div className="text-sm font-semibold text-white">Liveness check</div>
            <p className="text-xs text-ink-400">Prove you're a live person — a photo won't work.</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-ink-700 bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="w-full" style={{ transform: "scaleX(-1)" }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded-lg border p-3 text-center text-sm ${liveness.blinked ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-ink-700 text-ink-300"}`}>
              {liveness.blinked ? "✅" : "👁️"} Blink your eyes
            </div>
            <div className={`rounded-lg border p-3 text-center text-sm ${liveness.smiled ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-ink-700 text-ink-300"}`}>
              {liveness.smiled ? "✅" : "😄"} Smile at the camera
            </div>
          </div>
          <div className="text-center text-[10px] text-ink-500">{detectMsg}</div>
        </div>
      )}

      {step === "capture" && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-5 space-y-4">
          <div className="text-center">
            <div className="text-sm font-semibold text-white">
              Shot {captureIdx + 1} of {CAPTURE_TARGETS.length}
            </div>
            <p className="text-base text-sky-200">{CAPTURE_TARGETS[captureIdx]!.label}</p>
            <p className="text-xs text-ink-400">{CAPTURE_TARGETS[captureIdx]!.hint}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-ink-700 bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="w-full" style={{ transform: "scaleX(-1)" }} />
          </div>
          <div className="flex h-2 gap-1">
            {CAPTURE_TARGETS.map((_, i) => (
              <div key={i} className={`flex-1 rounded-full ${i < captureIdx ? "bg-emerald-500" : i === captureIdx ? "bg-sky-500" : "bg-ink-700"}`} />
            ))}
          </div>
          {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{error}</div>}
          <button type="button" onClick={takeShot}
                  className="w-full rounded-lg bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-500">
            📸 Capture this pose
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-5 space-y-4">
          <div className="text-center">
            <div className="text-4xl">✨</div>
            <div className="mt-2 text-sm font-semibold text-white">{captures.length} face fingerprints captured</div>
            <p className="mt-1 text-xs text-ink-400">Ready to enroll? Once saved, walking past the class camera marks you present.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setCaptures([]); setCaptureIdx(0); setStep("capture"); }}
                    className="flex-1 rounded-lg border border-ink-700 py-2.5 text-sm text-ink-300 hover:text-white">
              ↺ Retake all
            </button>
            <button type="button" onClick={() => { setStep("uploading"); enrollMut.mutate(); }}
                    disabled={enrollMut.isPending}
                    className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
              ✓ Save enrollment
            </button>
          </div>
        </div>
      )}

      {step === "uploading" && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-8 text-center text-sm text-ink-400">Saving…</div>
      )}

      {step === "done" && (
        <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 to-ink-900 p-6 space-y-4 text-center">
          <div className="text-5xl">✅</div>
          <div>
            <div className="font-display text-xl text-white">Face check-in enrolled</div>
            {alreadyEnrolled && (
              <div className="mt-1 text-xs text-ink-400">Last enrolled: {new Date(alreadyEnrolled).toLocaleDateString()}</div>
            )}
          </div>
          <p className="text-sm text-ink-300">Your coach can now mark you present by facing the class camera. No app needed.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/20">
              🗑 Delete + re-enroll
            </button>
            <Link to="/dashboard" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Back to dashboard →</Link>
          </div>
        </div>
      )}

      {step === "error" && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-3 text-center">
          <div className="text-4xl">⚠️</div>
          <div className="text-sm text-rose-200">{error}</div>
          <button type="button" onClick={() => { setError(null); setStep("consent"); }}
                  className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-white">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
