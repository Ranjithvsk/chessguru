// Owner-only page to submit / update the academy's white-label branding.
// Until super-admin approves via /admin/whitelabel, this data is saved as
// "pending" and only visible in preview mode. Publicly the academy's
// tenant page shows ChessGuru defaults.

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function fetchMeta() {
  const r = await fetch(`${API_BASE}/api/academy/meta`, { credentials: "include" });
  if (!r.ok) return null;
  return r.json();
}
async function fetchBrand(slug: string) {
  const r = await fetch(`${API_BASE}/api/academy/brand/${slug}`);
  if (!r.ok) return null;
  return r.json();
}

function fileToDataUrl(f: File, maxSizePx = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSizePx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("bad image"));
      img.src = fr.result as string;
    };
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(f);
  });
}

export default function AcademyBrandingPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data: meta } = useQuery({ queryKey: ["academy-meta"], queryFn: fetchMeta });
  const slug = meta?.academyId as string | undefined;
  const { data: brand } = useQuery({
    queryKey: ["brand", slug],
    queryFn: () => fetchBrand(slug!),
    enabled: !!slug,
  });

  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [brandColor, setBrandColor] = useState("#7c3aed");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [coachName, setCoachName] = useState("");
  const [coachBio, setCoachBio] = useState("");
  const [coachPhotoDataUrl, setCoachPhotoDataUrl] = useState<string | null>(null);
  const [coachAchievements, setCoachAchievements] = useState<string[]>([]);
  const [trophyGallery, setTrophyGallery] = useState<{ imageDataUrl: string; caption: string }[]>([]);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!brand) return;
    const preview = brand.pendingBrand ?? brand;
    setBrandName(preview.brandName || brand.name || "");
    setTagline(preview.tagline || "");
    setBrandColor(preview.brandColor || "#7c3aed");
    setLogoDataUrl(preview.logoDataUrl || null);
    setCoachName(preview.coachName || "");
    setCoachBio(preview.coachBio || "");
    setCoachPhotoDataUrl(preview.coachPhotoDataUrl || null);
    setCoachAchievements(preview.coachAchievements || []);
    setTrophyGallery(preview.trophyGallery || []);
  }, [brand]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/academy/branding`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName, tagline, brandColor, logoDataUrl,
          coachName, coachBio, coachPhotoDataUrl,
          coachAchievements: coachAchievements.filter((s) => s.trim()),
          trophyGallery: trophyGallery.filter((t) => t.imageDataUrl),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      setSaved("✓ Saved");
      qc.invalidateQueries({ queryKey: ["brand", slug] });
      setTimeout(() => setSaved(""), 2500);
    },
  });

  if (!auth?.loggedIn) return <div className="p-8 text-ink-400">Please sign in.</div>;
  if (meta && meta.role !== "academy_owner") return <div className="p-8 text-ink-400">Owner-only page.</div>;
  if (!brand) return <div className="p-8 text-ink-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-display text-2xl text-white">Academy branding</h1>
        <a href={`/a/${slug}`} target="_blank" rel="noreferrer"
          className="text-xs text-brand-400 underline hover:text-brand-300">
          Preview /a/{slug} →
        </a>
      </div>

      {!brand.approved && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          ⏳ <b>Pending approval.</b> Your branding is saved but the public page still shows ChessGuru defaults.
          The ChessGuru super-admin (ranjith.vsk) will review + approve. Until then, only you (in preview) see the custom brand.
        </div>
      )}
      {brand.approved && (
        <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          ✓ <b>Approved</b> by {brand.approvedBy} on {brand.approvedAt ? new Date(brand.approvedAt).toLocaleDateString() : ""}. Live at <code>/a/{slug}</code>.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-semibold text-white">Identity</h2>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Brand name</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)}
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Tagline</label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)}
              maxLength={200} placeholder="e.g. Nurturing chess champions since 2010"
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Brand colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-ink-600 bg-ink-800" />
              <input value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
                className="flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-sm text-white" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Logo (square, jpg/png)</label>
            <div className="flex items-center gap-3">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-800 text-2xl font-black text-ink-500">
                  {(brandName || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <input type="file" accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setLogoDataUrl(await fileToDataUrl(f, 512));
                }}
                className="text-xs text-ink-300 file:mr-2 file:rounded file:bg-brand-600 file:px-2 file:py-1 file:text-white" />
              {logoDataUrl && (
                <button onClick={() => setLogoDataUrl(null)} className="text-xs text-rose-300 hover:text-rose-200">Remove</button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="font-semibold text-white">Main coach</h2>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Coach name</label>
            <input value={coachName} onChange={(e) => setCoachName(e.target.value)}
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Coach bio</label>
            <textarea value={coachBio} onChange={(e) => setCoachBio(e.target.value)}
              rows={4} maxLength={2000}
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Coach photo</label>
            <div className="flex items-center gap-3">
              {coachPhotoDataUrl && <img src={coachPhotoDataUrl} alt="" className="h-16 w-16 rounded-full object-cover" />}
              <input type="file" accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setCoachPhotoDataUrl(await fileToDataUrl(f, 640));
                }}
                className="text-xs text-ink-300 file:mr-2 file:rounded file:bg-brand-600 file:px-2 file:py-1 file:text-white" />
              {coachPhotoDataUrl && (
                <button onClick={() => setCoachPhotoDataUrl(null)} className="text-xs text-rose-300 hover:text-rose-200">Remove</button>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-400">Achievements (medals, titles, tournament wins)</label>
            {coachAchievements.map((a, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input value={a}
                  onChange={(e) => setCoachAchievements((prev) => prev.map((v, ii) => ii === i ? e.target.value : v))}
                  placeholder="e.g. FIDE Instructor, 2200 ELO"
                  className="flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white" />
                <button onClick={() => setCoachAchievements((prev) => prev.filter((_, ii) => ii !== i))}
                  className="rounded border border-ink-600 px-2 text-xs text-rose-300 hover:bg-ink-800">✕</button>
              </div>
            ))}
            {coachAchievements.length < 20 && (
              <button onClick={() => setCoachAchievements((prev) => [...prev, ""])}
                className="rounded border border-dashed border-ink-600 px-3 py-1 text-xs text-ink-300 hover:bg-ink-800">
                + Add achievement
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 font-semibold text-white">Trophy gallery (photos of medals, trophies, students winning)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {trophyGallery.map((t, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
              <img src={t.imageDataUrl} alt="" className="h-32 w-full object-cover" />
              <div className="p-2">
                <input value={t.caption} maxLength={120}
                  onChange={(e) => setTrophyGallery((prev) => prev.map((v, ii) => ii === i ? { ...v, caption: e.target.value } : v))}
                  placeholder="Caption"
                  className="w-full rounded border border-ink-600 bg-ink-800 px-1.5 py-1 text-[11px] text-white" />
                <button onClick={() => setTrophyGallery((prev) => prev.filter((_, ii) => ii !== i))}
                  className="mt-1 w-full rounded text-[10px] text-rose-300 hover:text-rose-200">✕ Remove</button>
              </div>
            </div>
          ))}
          {trophyGallery.length < 12 && (
            <label className="flex h-32 cursor-pointer items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-900 text-xs text-ink-400 hover:bg-ink-800">
              <input type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const url = await fileToDataUrl(f, 800);
                  setTrophyGallery((prev) => [...prev, { imageDataUrl: url, caption: "" }]);
                }} />
              + Add photo
            </label>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save branding"}
        </button>
        {saved && <span className="text-sm text-emerald-300">{saved}</span>}
        {save.isError && <span className="text-sm text-rose-300">{(save.error as Error).message}</span>}
      </div>
    </div>
  );
}
