// AcademyProfileEdit.tsx — self-serve academy-page editor at /academy-profile/edit
//
// Signed-in academy_owner only. Mirrors CoachEdit's shape: identity + logo/cover
// + achievements + testimonials + featured-coach picker + custom-domain flow.
// All hooks above every early return (React #310).

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface Testimonial { id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string }
interface Socials {
  website?: string; twitter?: string; youtube?: string; instagram?: string; whatsapp?: string;
}
interface AcademyProfile {
  academyId: string; slug: string;
  displayName: string; tagline: string; description: string;
  logoUrl: string; coverUrl: string;
  country: string; city: string; foundedYear?: number;
  socials: Socials;
  achievements: Achievement[]; testimonials: Testimonial[];
  featuredCoachIds: string[];
  customDomain: string; customDomainStatus: string;
  updatedAt: string | null;
}
interface MineResp {
  academyId: string; slug: string; name: string | null;
  profile: AcademyProfile;
}
interface CoachRow {
  userId: string; username: string; fullName: string | null;
  role: string; isOwner: boolean;
  coachProfile: { displayName: string; photoUrl: string; titleClass: string };
}
interface AcademyPublicResp {
  coaches: CoachRow[];
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

function shortId(): string { return Math.random().toString(36).slice(2, 10); }

const inputCls = "w-full bg-ink-900/80 border border-ink-700 focus:border-cyan-500 rounded-lg px-3 py-2 text-ink-100 text-sm outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs text-ink-400">{label}</div>
      {children}
    </label>
  );
}

// Image slot: current + upload + "Generate with Gemini" (mirrors CoachEdit's).
function ImageSlot({
  currentUrl, onUploaded, uploadPath, genTarget, genSubId, defaultPrompt, aspect = "square",
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
  uploadPath: string;
  genTarget: "logo" | "cover" | "achievement" | "testimonial";
  genSubId?: string;
  defaultPrompt: string;
  aspect?: "square" | "wide";
}) {
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
      const r = await post<{ ok: boolean; url?: string; error?: string }>("/api/me/academy-profile/gen-image", body);
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
          <img src={currentUrl} alt="" className={`${box} object-cover bg-ink-800`} />
        ) : (
          <div className={`${box} bg-ink-800 grid place-items-center text-xs text-ink-500`}>
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
            className="px-3 py-1.5 rounded-lg bg-ink-700 hover:bg-ink-600 text-ink-100 disabled:opacity-60"
          >{uploading ? "Uploading…" : "Upload"}</button>
          <button
            type="button" onClick={() => setGenOpen((v) => !v)}
            className="px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white"
          >{genOpen ? "Cancel" : "✨ Generate"}</button>
        </div>
      </div>
      {genOpen && (
        <div className="rounded-lg bg-ink-900/80 border border-ink-700 p-3 space-y-2">
          <textarea
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            className="w-full text-xs bg-ink-800 border border-ink-700 rounded p-2 min-h-[60px] text-ink-100"
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

export default function AcademyProfileEditPage() {
  const qc = useQueryClient();
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string; role?: string; academyId?: string }>("/auth/me"),
  });
  const mineQ = useQuery({
    queryKey: ["me-academy-profile"],
    queryFn: () => get<MineResp>("/api/me/academy-profile"),
    enabled: !!authQ.data?.loggedIn && authQ.data.role === "academy_owner",
    retry: false,
  });
  // Coaches roster — pulled from the same public endpoint the landing page uses
  // (guest-readable, cached by slug). Feeds the featured-coach picker.
  const slug = mineQ.data?.slug || null;
  const coachesQ = useQuery({
    queryKey: ["academy-public", slug],
    queryFn: () => get<AcademyPublicResp>(`/api/academy-page/${encodeURIComponent(slug || "")}`),
    enabled: !!slug,
    retry: false,
  });

  const [form, setForm] = useState<AcademyProfile | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (mineQ.data?.profile && !form) setForm({ ...mineQ.data.profile });
  }, [mineQ.data, form]);

  const saveMut = useMutation({
    mutationFn: (body: Partial<AcademyProfile>) => post<MineResp>("/api/me/academy-profile", body),
    onSuccess: (r) => {
      setForm({ ...r.profile });
      setSaveMsg("Saved ✓");
      qc.invalidateQueries({ queryKey: ["academy-public", mineQ.data?.slug] });
      setTimeout(() => setSaveMsg(null), 2500);
    },
    onError: () => setSaveMsg("Save failed"),
  });

  const patch = useCallback(<K extends keyof AcademyProfile>(k: K, v: AcademyProfile[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }, []);
  const toggleFeatured = useCallback((coachId: string) => {
    setForm((f) => {
      if (!f) return f;
      const has = f.featuredCoachIds.includes(coachId);
      const next = has
        ? f.featuredCoachIds.filter((x) => x !== coachId)
        : [...f.featuredCoachIds, coachId];
      return { ...f, featuredCoachIds: next };
    });
  }, []);
  const moveFeatured = useCallback((coachId: string, dir: -1 | 1) => {
    setForm((f) => {
      if (!f) return f;
      const arr = [...f.featuredCoachIds];
      const i = arr.indexOf(coachId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return f;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      return { ...f, featuredCoachIds: arr };
    });
  }, []);

  const publicUrl = useMemo(() => (slug ? `/academy-page/${slug}` : "/"), [slug]);
  const coaches = coachesQ.data?.coaches || [];

  // ---- guards ----
  if (authQ.isLoading) {
    return <div className="max-w-3xl mx-auto p-8 text-ink-400 text-center">Loading…</div>;
  }
  if (!authQ.data?.loggedIn) return <Navigate to="/login" replace />;
  const role = authQ.data.role;
  if (role !== "academy_owner") {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <h1 className="text-xl font-bold text-ink-100 mb-2">Academy pages are for owners only</h1>
        <p className="text-ink-400 mb-4">Ask your academy owner to change your role, or head back to your dashboard.</p>
        <Link to="/dashboard" className="text-cyan-400 hover:underline">← Back to dashboard</Link>
      </div>
    );
  }
  if (mineQ.isLoading || !form) {
    return <div className="max-w-3xl mx-auto p-8 text-ink-400 text-center">Loading your academy…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6 text-ink-100">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Edit your public academy page</h1>
        <div className="flex items-center gap-2">
          {saveMsg && <span className="text-xs text-emerald-300">{saveMsg}</span>}
          <a
            href={publicUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm text-cyan-300 hover:text-cyan-200 underline"
          >See your public page →</a>
        </div>
      </div>
      <p className="text-sm text-ink-400">
        This page powers <code className="text-cyan-300">/academy-page/{slug}</code> — the public URL you can share to sign up new students.
      </p>

      {/* Logo + cover */}
      <section className="bg-ink-800/60 rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-ink-200">Logo & cover</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs text-ink-400 mb-2">Academy logo (round)</div>
            <ImageSlot
              currentUrl={form.logoUrl}
              onUploaded={(u) => patch("logoUrl", u)}
              uploadPath="/api/me/academy-profile/upload/logo"
              genTarget="logo"
              defaultPrompt="chess academy circular logo, a knight silhouette inside a shield, elegant serif wordmark, teal and gold on dark background, 1:1"
            />
          </div>
          <div>
            <div className="text-xs text-ink-400 mb-2">Cover banner (wide)</div>
            <ImageSlot
              currentUrl={form.coverUrl}
              onUploaded={(u) => patch("coverUrl", u)}
              uploadPath="/api/me/academy-profile/upload/cover"
              genTarget="cover"
              defaultPrompt="wide cinematic banner of a chess academy hall, warm evening light streaming through windows, chess boards on tables, shallow depth of field, 16:6 landscape"
              aspect="wide"
            />
          </div>
        </div>
      </section>

      {/* Identity */}
      <section className="bg-ink-800/60 rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-ink-200">Identity</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Display name">
            <input
              value={form.displayName} maxLength={120}
              onChange={(e) => patch("displayName", e.target.value)}
              className={inputCls} placeholder={mineQ.data?.name || slug || ""}
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
          <Field label="Founded (year)">
            <input
              type="number" min={1900} max={2100}
              value={form.foundedYear ?? ""}
              onChange={(e) => patch("foundedYear", e.target.value ? Number(e.target.value) : undefined)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Description (up to 5000 chars — supports **bold**, *italic*, blank lines for paragraphs)">
          <textarea
            value={form.description} maxLength={5000}
            onChange={(e) => patch("description", e.target.value)}
            className={`${inputCls} min-h-[160px] leading-relaxed`}
            placeholder="Tell parents & students who you are, how long you've been running, what makes your academy special…"
          />
        </Field>
      </section>

      {/* Socials */}
      <section className="bg-ink-800/60 rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-ink-200">Socials & contact</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {(["website", "twitter", "youtube", "instagram", "whatsapp"] as const).map((k) => (
            <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
              <input
                value={form.socials[k] ?? ""}
                onChange={(e) => patch("socials", { ...form.socials, [k]: e.target.value })}
                className={inputCls}
                placeholder={k === "website" ? "https://…" : k === "whatsapp" ? "919000012345" : "@yourhandle"}
              />
            </Field>
          ))}
        </div>
      </section>

      {/* Featured coach picker */}
      <section className="bg-ink-800/60 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink-200">Featured coaches</h2>
          <span className="text-xs text-ink-500">Empty = show all in default order</span>
        </div>
        {coaches.length === 0 ? (
          <p className="text-xs text-ink-500">
            No coaches in your academy yet — invite one from your <Link to="/academy" className="text-cyan-400 hover:underline">dashboard</Link>.
          </p>
        ) : (
          <>
            {form.featuredCoachIds.length > 0 && (
              <div className="rounded-lg bg-ink-900/50 border border-ink-700/60 p-3 space-y-2">
                <div className="text-xs text-ink-400 mb-1">Featured order (top to bottom):</div>
                {form.featuredCoachIds.map((cid, i) => {
                  const c = coaches.find((x) => x.userId === cid);
                  return (
                    <div key={cid} className="flex items-center gap-3 rounded bg-ink-800/70 px-3 py-2">
                      <span className="text-xs text-ink-500 w-6">{i + 1}.</span>
                      {c?.coachProfile.photoUrl ? (
                        <img src={c.coachProfile.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover bg-ink-900" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-xs font-bold text-white">
                          {(c?.coachProfile.displayName || c?.username || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-sm text-ink-100 truncate">
                        {c?.coachProfile.displayName || c?.fullName || c?.username || cid}
                      </div>
                      <button
                        type="button" onClick={() => moveFeatured(cid, -1)}
                        disabled={i === 0}
                        className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 text-xs disabled:opacity-40"
                      >↑</button>
                      <button
                        type="button" onClick={() => moveFeatured(cid, 1)}
                        disabled={i === form.featuredCoachIds.length - 1}
                        className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 text-xs disabled:opacity-40"
                      >↓</button>
                      <button
                        type="button" onClick={() => toggleFeatured(cid)}
                        className="px-2 py-1 rounded bg-rose-700/50 hover:bg-rose-700 text-xs text-white"
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div>
              <div className="text-xs text-ink-400 mb-2">Available coaches — click to feature:</div>
              <div className="flex flex-wrap gap-2">
                {coaches
                  .filter((c) => !form.featuredCoachIds.includes(c.userId))
                  .map((c) => (
                    <button
                      key={c.userId} type="button"
                      onClick={() => toggleFeatured(c.userId)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ink-700/60 hover:bg-cyan-600/40 text-ink-200 hover:text-white text-xs"
                    >
                      {c.coachProfile.photoUrl ? (
                        <img src={c.coachProfile.photoUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <span className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-[10px] font-bold text-white">
                          {(c.coachProfile.displayName || c.username).charAt(0).toUpperCase()}
                        </span>
                      )}
                      {c.coachProfile.displayName || c.fullName || c.username}
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Achievements */}
      <RowSection<Achievement>
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

      {/* Testimonials */}
      <RowSection<Testimonial>
        title="💬 Testimonials"
        items={form.testimonials}
        onChange={(rows) => patch("testimonials", rows)}
        addLabel="Add testimonial"
        genTarget="testimonial"
        defaultPrompt="portrait of a delighted parent of a chess student, warm smile, natural light, 1:1"
        renderRow={(row, upd) => (
          <>
            <input value={row.author} onChange={(e) => upd({ author: e.target.value })}
              className={inputCls} placeholder="Author (e.g. Ramesh K.)" />
            <input value={row.role ?? ""} onChange={(e) => upd({ role: e.target.value })}
              className={inputCls} placeholder="Role (e.g. Parent of Aarav, U-10)" />
            <textarea value={row.quote} onChange={(e) => upd({ quote: e.target.value })}
              className={`${inputCls} min-h-[80px]`} placeholder="The testimonial itself…" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-400">Rating:</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button"
                  onClick={() => upd({ rating: row.rating === n ? undefined : n })}
                  className={`text-lg ${row.rating && n <= row.rating ? "text-amber-300" : "text-ink-600 hover:text-ink-400"}`}
                >★</button>
              ))}
              {typeof row.rating === "number" && (
                <button type="button" onClick={() => upd({ rating: undefined })} className="text-xs text-ink-500 hover:text-ink-300 ml-1">clear</button>
              )}
            </div>
          </>
        )}
        newRow={() => ({ id: shortId(), author: "", quote: "" })}
      />

      {/* Custom domain */}
      <DomainSection />

      {/* Save */}
      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          type="button" onClick={() => { setSaveMsg(null); saveMut.mutate(form); }}
          disabled={saveMut.isPending}
          className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-semibold shadow-lg shadow-cyan-500/20 disabled:opacity-60"
        >{saveMut.isPending ? "Saving…" : "Save academy page"}</button>
      </div>
    </div>
  );
}

interface RowSectionProps<T extends { id: string; imageUrl?: string }> {
  title: string;
  items: T[];
  onChange: (rows: T[]) => void;
  addLabel: string;
  genTarget: "achievement" | "testimonial";
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
    <section className="bg-ink-800/60 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink-200">{title}</h2>
        <button
          type="button" onClick={() => onChange([...items, newRow()])}
          className="px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs"
        >+ {addLabel}</button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-ink-500">Nothing here yet — add your first entry.</p>
      ) : (
        <div className="space-y-4">
          {items.map((row) => (
            <div key={row.id} className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 p-4 rounded-xl bg-ink-900/50 border border-ink-700/60">
              <div>
                <ImageSlot
                  currentUrl={row.imageUrl || ""}
                  onUploaded={(url) => updateRow(row.id, { imageUrl: url } as Partial<T>)}
                  uploadPath={`/api/me/academy-profile/upload/${genTarget}/${row.id}`}
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

/* ------------- Custom-domain section (5 states, mirrors CoachEdit) ------------- */
interface DomainStatus {
  domain: string; status: string;
  addedAt: string | null; lastCheckedAt: string | null; activatedAt: string | null;
  error: string; cnameTarget: string; aTarget: string;
}
function DomainSection() {
  const qc = useQueryClient();
  const statusQ = useQuery<DomainStatus>({
    queryKey: ["academy-domain-status"],
    queryFn: () => get<DomainStatus>("/api/me/academy-profile/domain/status"),
    refetchInterval: (q) => {
      const s = q.state?.data?.status;
      return s === "verifying" || s === "provisioning" ? 5000 : false;
    },
  });
  const [input, setInput] = useState("");
  const [uiErr, setUiErr] = useState<string | null>(null);

  const setMut = useMutation({
    mutationFn: async (domain: string) => {
      const r = await fetch(`${BASE}/api/me/academy-profile/domain/set`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
      return j as DomainStatus;
    },
    onSuccess: () => { setUiErr(null); setInput(""); qc.invalidateQueries({ queryKey: ["academy-domain-status"] }); },
    onError: (e: any) => setUiErr(String(e?.message || e)),
  });
  const verifyMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/me/academy-profile/domain/verify`, {
        method: "POST", credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
      return j as DomainStatus;
    },
    onSuccess: () => { setUiErr(null); qc.invalidateQueries({ queryKey: ["academy-domain-status"] }); },
    onError: (e: any) => setUiErr(String(e?.message || e)),
  });
  const removeMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/me/academy-profile/domain/remove`, {
        method: "POST", credentials: "include",
      });
      return r.json() as Promise<DomainStatus>;
    },
    onSuccess: () => { setUiErr(null); qc.invalidateQueries({ queryKey: ["academy-domain-status"] }); },
  });
  const copy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* no-op */ }
  }, []);

  const s = statusQ.data;
  const status = s?.status || "";
  const domain = s?.domain || "";
  const cnameTarget = s?.cnameTarget || "coach.dreamcy.com";
  const aTarget = s?.aTarget || "213.32.21.226";

  return (
    <section className="bg-ink-800/60 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink-200">Custom domain</h2>
        {domain && status && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            status === "active" ? "bg-emerald-500/20 text-emerald-300"
            : status === "failed" ? "bg-rose-500/20 text-rose-300"
            : status === "pending_dns" ? "bg-amber-500/20 text-amber-300"
            : "bg-cyan-500/20 text-cyan-300"
          }`}>{status.replace(/_/g, " ")}</span>
        )}
      </div>

      {(!domain || !status) && (
        <>
          <p className="text-xs text-ink-400">
            Point your own domain at your academy page (e.g.
            <code className="mx-1 px-1 bg-ink-900/70 rounded">youracademy.com</code>).
            We'll issue a free SSL cert automatically after you set the DNS record.
          </p>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toLowerCase().trim())}
              placeholder="e.g. youracademy.com"
              className={inputCls} maxLength={253}
            />
            <button
              type="button"
              disabled={!input || setMut.isPending}
              onClick={() => setMut.mutate(input)}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm disabled:opacity-60 whitespace-nowrap"
            >{setMut.isPending ? "Saving…" : "Add domain"}</button>
          </div>
          {uiErr && <p className="text-xs text-rose-400">{uiErr}</p>}
        </>
      )}

      {status === "pending_dns" && (
        <>
          <div className="rounded-lg bg-ink-900/60 border border-ink-700 p-4 space-y-3">
            <p className="text-sm text-ink-200 font-medium">
              Add ONE of these DNS records at your domain registrar for
              <code className="mx-1 px-1 bg-ink-950 rounded">{domain}</code>:
            </p>
            <div className="text-xs space-y-2 font-mono">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-cyan-700 text-white">CNAME</span>
                <span className="text-ink-400">host:</span>
                <code className="text-ink-100">@ (or subdomain)</code>
                <span className="text-ink-400">→</span>
                <code className="text-emerald-300">{cnameTarget}</code>
                <button type="button" onClick={() => copy(cnameTarget)}
                  className="px-2 py-0.5 rounded bg-ink-700 hover:bg-ink-600 text-white text-xs">Copy</button>
              </div>
              <div className="text-ink-500 text-xs">— OR —</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-ink-700 text-white">A</span>
                <span className="text-ink-400">host:</span>
                <code className="text-ink-100">@</code>
                <span className="text-ink-400">→</span>
                <code className="text-emerald-300">{aTarget}</code>
                <button type="button" onClick={() => copy(aTarget)}
                  className="px-2 py-0.5 rounded bg-ink-700 hover:bg-ink-600 text-white text-xs">Copy</button>
              </div>
            </div>
            <p className="text-xs text-ink-500">
              DNS changes usually take 5-30 min to propagate. If you use Cloudflare,
              make sure the record is set to DNS-only (grey cloud).
            </p>
          </div>
          {s?.error && <p className="text-xs text-amber-300">{s.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={() => verifyMut.mutate()}
              disabled={verifyMut.isPending}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm disabled:opacity-60"
            >{verifyMut.isPending ? "Checking DNS…" : "I've added it — Verify now"}</button>
            <button
              type="button" onClick={() => removeMut.mutate()}
              className="px-3 py-2 rounded-lg bg-ink-700 hover:bg-ink-600 text-ink-100 text-sm"
            >Change domain</button>
          </div>
          {uiErr && <p className="text-xs text-rose-400">{uiErr}</p>}
        </>
      )}

      {(status === "verifying" || status === "provisioning") && (
        <div className="rounded-lg bg-ink-900/60 border border-ink-700 p-4 flex items-start gap-3">
          <div className="mt-0.5 h-4 w-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          <div className="space-y-1">
            <p className="text-sm text-ink-100">Provisioning your SSL certificate for
              <code className="mx-1 px-1 bg-ink-950 rounded">{domain}</code>…</p>
            <p className="text-xs text-ink-500">This usually takes 30-60 seconds. This page auto-refreshes.</p>
          </div>
        </div>
      )}

      {status === "active" && (
        <>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4">
            <p className="text-sm text-emerald-300 font-medium">
              ✓ Your academy is live at{" "}
              <a href={`https://${domain}`} target="_blank" rel="noreferrer"
                className="underline hover:text-emerald-200">https://{domain}</a>
            </p>
            {s?.activatedAt && (
              <p className="text-xs text-emerald-500/80 mt-1">
                Activated {new Date(s.activatedAt).toLocaleString()}
              </p>
            )}
          </div>
          <button
            type="button" onClick={() => removeMut.mutate()}
            disabled={removeMut.isPending}
            className="px-3 py-2 rounded-lg bg-ink-700 hover:bg-ink-600 text-ink-100 text-sm disabled:opacity-60"
          >{removeMut.isPending ? "Removing…" : "Remove this domain"}</button>
        </>
      )}

      {status === "failed" && (
        <>
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-4 space-y-1">
            <p className="text-sm text-rose-300 font-medium">SSL provisioning failed for
              <code className="mx-1 px-1 bg-ink-950 rounded">{domain}</code></p>
            <p className="text-xs text-rose-400/90">{s?.error || "Unknown error — try again in an hour."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={() => verifyMut.mutate()}
              disabled={verifyMut.isPending}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm disabled:opacity-60"
            >{verifyMut.isPending ? "Retrying…" : "Try again"}</button>
            <button
              type="button" onClick={() => removeMut.mutate()}
              className="px-3 py-2 rounded-lg bg-ink-700 hover:bg-ink-600 text-ink-100 text-sm"
            >Change domain</button>
          </div>
          {uiErr && <p className="text-xs text-rose-400">{uiErr}</p>}
        </>
      )}
    </section>
  );
}
