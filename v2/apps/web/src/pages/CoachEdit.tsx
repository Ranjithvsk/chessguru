// CoachEdit.tsx — self-serve editor at /coach-profile/edit
//
// Signed-in coach/owner only. Guards with /auth/me + role check; falls
// back to /login for anonymous. Every field in coachProfiles is editable
// here. Images get an Upload + "Generate with Gemini" pair.

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface TopStudent  { id: string; name: string; peakRating?: number; note?: string; imageUrl?: string }
interface Trophy      { id: string; name: string; year?: number; imageUrl?: string }
interface Socials {
  website?: string; twitter?: string; youtube?: string; instagram?: string; lichess?: string; chesscom?: string;
}
interface CoachProfile {
  userId: string;
  displayName: string; tagline: string; bio: string;
  country: string; city: string;
  titleClass: string; elo?: number; federation: string;
  yearsTeaching?: number; playingStyles: string[];
  photoUrl: string; coverUrl: string;
  achievements: Achievement[]; topStudents: TopStudent[]; trophies: Trophy[];
  socials: Socials;
  customDomain: string; customDomainStatus: string;
  updatedAt: string | null;
}
interface MineResp {
  userId: string;
  username: string | null;
  fullName: string | null;
  profile: CoachProfile;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) {
    const err: any = new Error(`GET ${path} → ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return r.json() as Promise<T>;
}
async function uploadImage(path: string, file: File): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": file.type },
    body: file,
  });
  return r.json();
}

const STYLES = ["Aggressive", "Positional", "Tactical", "Solid", "Universal"] as const;
const TITLES = ["", "CM", "NM", "FM", "IM", "GM", "WCM", "WNM", "WFM", "WIM", "WGM"] as const;

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Small inline image-editor block: current image + upload + Gemini prompt.
// Reused for photo, cover, achievement/trophy/topStudent rows.
function ImageSlot({
  currentUrl,
  onUploaded,
  uploadPath,
  genTarget,
  genSubId,
  defaultPrompt,
  aspect = "square",
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
  uploadPath: string;
  genTarget: "photo" | "cover" | "achievement" | "trophy" | "topStudent";
  genSubId?: string;
  defaultPrompt: string;
  aspect?: "square" | "wide";
}) {
  // Hooks always first.
  const [genOpen, setGenOpen] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr("Pick an image file (jpg/png/webp/gif)"); return; }
    if (f.size > 8 * 1024 * 1024) { setErr("Image too large (max 8 MB)"); return; }
    setErr(null); setUploading(true);
    try {
      const r = await uploadImage(uploadPath, f);
      if (r.ok && r.url) onUploaded(r.url);
      else setErr(r.error || "Upload failed");
    } finally { setUploading(false); }
  };
  const handleGen = async () => {
    if (!prompt.trim()) { setErr("Write a prompt first"); return; }
    setErr(null); setGenerating(true);
    try {
      const body: any = { target: genTarget, prompt };
      if (genSubId) body.subId = genSubId;
      const r = await post<{ ok: boolean; url?: string; error?: string }>("/api/me/coach-profile/gen-image", body);
      if (r.ok && r.url) { onUploaded(r.url); setGenOpen(false); }
      else setErr(r.error || "Generation failed");
    } finally { setGenerating(false); }
  };

  const box = aspect === "wide"
    ? "w-full aspect-[16/6] rounded-xl"
    : "w-24 h-24 rounded-lg";

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {currentUrl ? (
          <img src={currentUrl} alt="" className={`${box} object-cover bg-slate-800`} />
        ) : (
          <div className={`${box} bg-slate-800 grid place-items-center text-xs text-slate-500`}>
            no image
          </div>
        )}
        <div className="flex flex-col gap-2 text-xs">
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
          <button
            type="button" onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-60"
          >{uploading ? "Uploading…" : "Upload"}</button>
          <button
            type="button" onClick={() => setGenOpen((v) => !v)}
            className="px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white"
          >{genOpen ? "Cancel" : "✨ Generate"}</button>
        </div>
      </div>
      {genOpen && (
        <div className="rounded-lg bg-slate-900/80 border border-slate-700 p-3 space-y-2">
          <textarea
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            className="w-full text-xs bg-slate-800 border border-slate-700 rounded p-2 min-h-[60px] text-slate-100"
            placeholder="Describe the image you want…"
          />
          <button
            type="button" onClick={handleGen} disabled={generating}
            className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-60"
          >{generating ? "Calling Gemini…" : "Generate now"}</button>
        </div>
      )}
      {err && <p className="text-xs text-rose-400">{err}</p>}
    </div>
  );
}

export default function CoachProfileEditPage() {
  // All hooks above every early return.
  const qc = useQueryClient();
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string; role?: string }>("/auth/me"),
  });
  const mineQ = useQuery({
    queryKey: ["me-coach-profile"],
    queryFn: () => get<MineResp>("/api/me/coach-profile"),
    enabled: !!authQ.data?.loggedIn && (authQ.data.role === "coach" || authQ.data.role === "academy_owner"),
    retry: false,
  });
  const [form, setForm] = useState<CoachProfile | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (mineQ.data?.profile && !form) setForm({ ...mineQ.data.profile });
  }, [mineQ.data, form]);

  const saveMut = useMutation({
    mutationFn: (body: Partial<CoachProfile>) => post<MineResp>("/api/me/coach-profile", body),
    onSuccess: (r) => {
      setForm({ ...r.profile });
      setSaveMsg("Saved ✓");
      qc.invalidateQueries({ queryKey: ["coach-public", mineQ.data?.username] });
      setTimeout(() => setSaveMsg(null), 2500);
    },
    onError: () => setSaveMsg("Save failed"),
  });

  const patch = useCallback(<K extends keyof CoachProfile>(k: K, v: CoachProfile[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }, []);
  const toggleStyle = useCallback((s: string) => {
    setForm((f) => {
      if (!f) return f;
      const has = f.playingStyles.includes(s);
      const next = has ? f.playingStyles.filter((x) => x !== s) : [...f.playingStyles, s].slice(0, 5);
      return { ...f, playingStyles: next };
    });
  }, []);

  const username = mineQ.data?.username || authQ.data?.username || "";
  const publicUrl = useMemo(() => (username ? `/coach/${username}` : "/"), [username]);

  // ---- guards ----
  if (authQ.isLoading) {
    return <div className="max-w-3xl mx-auto p-8 text-slate-400 text-center">Loading…</div>;
  }
  if (!authQ.data?.loggedIn) return <Navigate to="/login" replace />;
  const role = authQ.data.role;
  if (role !== "coach" && role !== "academy_owner") {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <h1 className="text-xl font-bold text-slate-100 mb-2">Coach profiles are for coaches only</h1>
        <p className="text-slate-400 mb-4">Ask your academy owner to change your role, or head back to your dashboard.</p>
        <Link to="/dashboard" className="text-cyan-400 hover:underline">← Back to dashboard</Link>
      </div>
    );
  }
  if (mineQ.isLoading || !form) {
    return <div className="max-w-3xl mx-auto p-8 text-slate-400 text-center">Loading your profile…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6 text-slate-100">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Edit your public profile</h1>
        <div className="flex items-center gap-2">
          {saveMsg && <span className="text-xs text-emerald-300">{saveMsg}</span>}
          <a
            href={publicUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm text-cyan-300 hover:text-cyan-200 underline"
          >See your public page →</a>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        This page powers <code className="text-cyan-300">/coach/{username}</code> — the public URL you can share with prospective students.
      </p>

      {/* Photo + cover */}
      <section className="bg-slate-800/60 rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-slate-200">Photo & cover</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs text-slate-400 mb-2">Headshot (round)</div>
            <ImageSlot
              currentUrl={form.photoUrl}
              onUploaded={(u) => patch("photoUrl", u)}
              uploadPath="/api/me/coach-profile/upload/photo"
              genTarget="photo"
              defaultPrompt="professional headshot of a chess coach, warm smile, chess pieces softly blurred in background, cinematic lighting, high detail, 1:1 aspect"
            />
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-2">Cover banner (wide)</div>
            <ImageSlot
              currentUrl={form.coverUrl}
              onUploaded={(u) => patch("coverUrl", u)}
              uploadPath="/api/me/coach-profile/upload/cover"
              genTarget="cover"
              defaultPrompt="wide cinematic banner of a dramatic chess tournament hall, warm evening light, shallow depth of field, 16:6 landscape"
              aspect="wide"
            />
          </div>
        </div>
      </section>

      {/* Identity */}
      <section className="bg-slate-800/60 rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-slate-200">Identity</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Display name">
            <input
              value={form.displayName} maxLength={120}
              onChange={(e) => patch("displayName", e.target.value)}
              className={inputCls} placeholder={mineQ.data?.fullName || username}
            />
          </Field>
          <Field label="Tagline">
            <input
              value={form.tagline} maxLength={240}
              onChange={(e) => patch("tagline", e.target.value)}
              className={inputCls}
              placeholder="One-liner shown under your name"
            />
          </Field>
          <Field label="Title">
            <select
              value={form.titleClass} onChange={(e) => patch("titleClass", e.target.value)}
              className={inputCls}
            >
              {TITLES.map((t) => <option key={t || "none"} value={t}>{t || "— none —"}</option>)}
            </select>
          </Field>
          <Field label="FIDE Elo">
            <input
              type="number" min={0} max={3999}
              value={form.elo ?? ""} onChange={(e) => patch("elo", e.target.value ? Number(e.target.value) : undefined)}
              className={inputCls}
            />
          </Field>
          <Field label="Country (2-letter, e.g. IN, US)">
            <input
              value={form.country} maxLength={2}
              onChange={(e) => patch("country", e.target.value.toUpperCase())}
              className={inputCls} placeholder="IN"
            />
          </Field>
          <Field label="City">
            <input
              value={form.city} maxLength={80}
              onChange={(e) => patch("city", e.target.value)}
              className={inputCls} placeholder="Chennai"
            />
          </Field>
          <Field label="Federation">
            <input
              value={form.federation} maxLength={20}
              onChange={(e) => patch("federation", e.target.value)}
              className={inputCls} placeholder="AICF"
            />
          </Field>
          <Field label="Years teaching">
            <input
              type="number" min={0} max={99}
              value={form.yearsTeaching ?? ""}
              onChange={(e) => patch("yearsTeaching", e.target.value ? Number(e.target.value) : undefined)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Bio (up to 3000 chars — supports **bold**, *italic*, blank lines for paragraphs)">
          <textarea
            value={form.bio} maxLength={3000}
            onChange={(e) => patch("bio", e.target.value)}
            className={`${inputCls} min-h-[160px] leading-relaxed`}
            placeholder="Tell students who you are, what you teach, what your style is…"
          />
        </Field>
        <Field label="Playing styles (pick up to 5)">
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => {
              const on = form.playingStyles.includes(s);
              return (
                <button
                  key={s} type="button" onClick={() => toggleStyle(s)}
                  className={
                    "px-3 py-1.5 rounded-full text-sm border transition-colors " +
                    (on
                      ? "bg-cyan-600 border-cyan-400 text-white"
                      : "bg-slate-700/60 border-slate-600 text-slate-300 hover:bg-slate-700")
                  }
                >{s}</button>
              );
            })}
          </div>
        </Field>
      </section>

      {/* Socials */}
      <section className="bg-slate-800/60 rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-slate-200">Socials</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {(["website", "twitter", "youtube", "instagram", "lichess", "chesscom"] as const).map((k) => (
            <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
              <input
                value={form.socials[k] ?? ""}
                onChange={(e) => patch("socials", { ...form.socials, [k]: e.target.value })}
                className={inputCls}
                placeholder={k === "website" ? "https://…" : "@yourhandle"}
              />
            </Field>
          ))}
        </div>
      </section>

      {/* Achievements */}
      <RowSection
        title="🏆 Achievements"
        items={form.achievements}
        onChange={(rows) => patch("achievements", rows)}
        addLabel="Add achievement"
        genTarget="achievement"
        defaultPrompt="a chess trophy medal with laurel wreath, painterly, warm gold light, 1:1"
        renderRow={(row, upd) => (
          <>
            <input value={row.title} onChange={(e) => upd({ title: e.target.value })}
              className={inputCls} placeholder="Achievement title" />
            <textarea value={row.description ?? ""} onChange={(e) => upd({ description: e.target.value })}
              className={`${inputCls} min-h-[60px]`} placeholder="Short description (optional)" />
            <input type="number" min={1900} max={2100} value={row.year ?? ""}
              onChange={(e) => upd({ year: e.target.value ? Number(e.target.value) : undefined })}
              className={inputCls} placeholder="Year (optional)" />
          </>
        )}
        newRow={() => ({ id: shortId(), title: "" })}
      />

      {/* Top students */}
      <RowSection
        title="🎓 Top Students"
        items={form.topStudents}
        onChange={(rows) => patch("topStudents", rows)}
        addLabel="Add student"
        genTarget="topStudent"
        defaultPrompt="portrait of a bright young chess student, smiling, natural light, 1:1"
        renderRow={(row, upd) => (
          <>
            <input value={row.name} onChange={(e) => upd({ name: e.target.value })}
              className={inputCls} placeholder="Student name" />
            <input type="number" min={0} max={3999} value={row.peakRating ?? ""}
              onChange={(e) => upd({ peakRating: e.target.value ? Number(e.target.value) : undefined })}
              className={inputCls} placeholder="Peak rating (optional)" />
            <input value={row.note ?? ""} onChange={(e) => upd({ note: e.target.value })}
              className={inputCls} placeholder="One-liner note (optional)" />
          </>
        )}
        newRow={() => ({ id: shortId(), name: "" })}
      />

      {/* Trophies */}
      <RowSection
        title="🏅 Trophies"
        items={form.trophies}
        onChange={(rows) => patch("trophies", rows)}
        addLabel="Add trophy"
        genTarget="trophy"
        defaultPrompt="a golden chess trophy with a knight silhouette on top, dramatic side light, 1:1"
        renderRow={(row, upd) => (
          <>
            <input value={row.name} onChange={(e) => upd({ name: e.target.value })}
              className={inputCls} placeholder="Trophy name" />
            <input type="number" min={1900} max={2100} value={row.year ?? ""}
              onChange={(e) => upd({ year: e.target.value ? Number(e.target.value) : undefined })}
              className={inputCls} placeholder="Year (optional)" />
          </>
        )}
        newRow={() => ({ id: shortId(), name: "" })}
      />

      {/* Custom domain */}
      <section className="bg-slate-800/60 rounded-2xl p-6 space-y-3">
        <h2 className="font-semibold text-slate-200">Custom domain</h2>
        <p className="text-xs text-slate-400">
          Coming soon — DNS + SSL automation is Phase 2. Add your domain now so we know
          what to wire when we ship it.
        </p>
        <input
          value={form.customDomain} maxLength={240}
          onChange={(e) => patch("customDomain", e.target.value.toLowerCase())}
          className={inputCls} placeholder="e.g. coach-you.com"
        />
        {form.customDomain && form.customDomainStatus && (
          <div className="text-xs text-slate-400">
            Status: <span className="text-slate-200">{form.customDomainStatus.replace(/_/g, " ")}</span>
          </div>
        )}
      </section>

      {/* Save */}
      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          type="button" onClick={() => { setSaveMsg(null); saveMut.mutate(form); }}
          disabled={saveMut.isPending}
          className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-semibold shadow-lg shadow-cyan-500/20 disabled:opacity-60"
        >{saveMut.isPending ? "Saving…" : "Save profile"}</button>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-slate-900/80 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-2 text-slate-100 text-sm outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs text-slate-400">{label}</div>
      {children}
    </label>
  );
}

interface RowSectionProps<T extends { id: string; imageUrl?: string }> {
  title: string;
  items: T[];
  onChange: (rows: T[]) => void;
  addLabel: string;
  genTarget: "achievement" | "trophy" | "topStudent";
  defaultPrompt: string;
  renderRow: (row: T, upd: (partial: Partial<T>) => void) => React.ReactNode;
  newRow: () => T;
}
function RowSection<T extends { id: string; imageUrl?: string }>(props: RowSectionProps<T>) {
  const { title, items, onChange, addLabel, genTarget, defaultPrompt, renderRow, newRow } = props;
  const updateRow = (id: string, partial: Partial<T>) =>
    onChange(items.map((r) => (r.id === id ? { ...r, ...partial } : r)));
  const deleteRow = (id: string) => onChange(items.filter((r) => r.id !== id));
  return (
    <section className="bg-slate-800/60 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-200">{title}</h2>
        <button
          type="button" onClick={() => onChange([...items, newRow()])}
          className="px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs"
        >+ {addLabel}</button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing here yet — add your first entry.</p>
      ) : (
        <div className="space-y-4">
          {items.map((row) => (
            <div key={row.id} className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-700/60">
              <div>
                <ImageSlot
                  currentUrl={row.imageUrl || ""}
                  onUploaded={(url) => updateRow(row.id, { imageUrl: url } as Partial<T>)}
                  uploadPath={`/api/me/coach-profile/upload/${genTarget}/${row.id}`}
                  genTarget={genTarget}
                  genSubId={row.id}
                  defaultPrompt={defaultPrompt}
                />
              </div>
              <div className="space-y-2">
                {renderRow(row, (partial) => updateRow(row.id, partial))}
                <button
                  type="button" onClick={() => deleteRow(row.id)}
                  className="text-xs text-rose-400 hover:text-rose-300"
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
