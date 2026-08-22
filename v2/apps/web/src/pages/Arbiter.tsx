// /arbiter and /arbiter/:id — Swiss-system tournament management for chess
// arbiters. Powered by JaVaFo (FIDE-endorsed Dutch Swiss engine) via
// /api/pairings/*.
//
// Two views in one file for brevity:
//   - /arbiter          — list my tournaments + "new tournament" form
//   - /arbiter/:id      — one tournament: players tab, rounds tab, standings,
//                          publish-to-chess-results, TRF16 download
//
// Design: dark-neutral admin surface (matches app tokens); pairings table
// is dense and printable so arbiters can hand copies to boards.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, deleteJson } from "../lib/api";

interface TournamentSummary {
  _id: string; slug: string; name: string; city?: string; start_date?: string; end_date?: string;
  rating_type: string; num_rounds: number; num_players: number; num_rounds_played: number; cr_published: boolean;
}
interface Player {
  rank: number; name: string; sex?: string | null; title?: string; rating?: number;
  federation?: string; fide_id?: string; birth?: string; cr_uid?: number | null;
}
interface Pairing {
  board: number; white_rank: number; black_rank: number; result: string | null;
  cr_pushed?: { at: string; status: string; msg: string } | null;
}
interface Round { round_no: number; pairings: Pairing[]; generated_at: string; }
interface Tournament {
  _id: string; slug: string; name: string; city?: string; federation?: string; start_date?: string; end_date?: string;
  time_control?: string; num_rounds: number; rating_type: string; first_color: string;
  chief_arbiter?: string; cr_sid?: string | null; cr_tournament?: string | null;
  is_public?: boolean;
  players: Player[]; rounds: Round[];
  standings: Array<{ place: number; rank: number; name: string; rating: number; points: number; buchholz: number; sb: number }>;
}

// ═══════════════ /arbiter — list + new tournament ═══════════════

export default function ArbiterList() {
  const id = useParams().id;
  if (id) return <ArbiterDetail id={id} />;

  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["arbiter", "list"],
    queryFn: () => get<{ rows: TournamentSummary[] }>("/api/pairings/tournaments"),
  });
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-brand-400">Arbiter tools</div>
          <h1 className="mt-1 font-display text-3xl">My tournaments</h1>
          <p className="mt-1 text-sm text-ink-400">
            FIDE Swiss pairings via JaVaFo · live standings with Buchholz / SB tiebreaks · TRF16 export for AICF submission ·
            optional publish to chess-results.com.
          </p>
        </div>
        <button onClick={() => setNewOpen(true)}
                className="rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white shadow hover:brightness-110">
          + New tournament
        </button>
      </header>

      {isLoading ? <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-8 text-center text-ink-400">Loading…</div>
       : !data?.rows.length ? (
        <div className="rounded-3xl border border-ink-700 bg-ink-900/40 p-12 text-center">
          <div className="text-4xl mb-3">♟</div>
          <div className="font-semibold text-white">No tournaments yet.</div>
          <div className="mt-1 text-sm text-ink-400">Create your first Swiss to generate pairings, track standings, and export TRF16 for FIDE/AICF submission.</div>
          <button onClick={() => setNewOpen(true)}
                  className="mt-5 rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white">
            Create tournament →
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {data.rows.map((t) => (
            <Link key={t._id} to={`/arbiter/${t._id}`}
                  className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-700 bg-ink-900/60 p-4 transition hover:border-brand-500/40 hover:bg-ink-900">
              <div className="min-w-0">
                <div className="font-semibold text-white group-hover:text-brand-300">{t.name}</div>
                <div className="mt-0.5 text-xs text-ink-400">
                  {t.city || "—"} · {t.rating_type} · {t.num_players} players ·
                  Round {t.num_rounds_played}/{t.num_rounds}
                  {t.cr_published && <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">chess-results</span>}
                </div>
              </div>
              <div className="text-xs text-ink-400">{t.start_date || ""}</div>
            </Link>
          ))}
        </div>
      )}

      {newOpen && (
        <NewTournamentModal onClose={() => setNewOpen(false)}
          onCreated={(id) => { qc.invalidateQueries({ queryKey: ["arbiter", "list"] }); nav(`/arbiter/${id}`); }} />
      )}
    </div>
  );
}

function NewTournamentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("Chennai");
  const [numRounds, setNumRounds] = useState(5);
  const [ratingType, setRatingType] = useState("UNRATED");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10).replace(/-/g, "/"));
  const [firstColor, setFirstColor] = useState<"white1" | "black1" | "rank">("white1");
  const [chief, setChief] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ ok: boolean; _id?: string; error?: string }>("/api/pairings/tournaments", {
      name, city, num_rounds: numRounds, rating_type: ratingType, start_date: startDate, first_color: firstColor, chief_arbiter: chief,
    }),
    onSuccess: (r) => { if (r.ok && r._id) onCreated(r._id); else setErr(r.error || "Create failed"); },
    onError: () => setErr("Network error"),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-ink-700 bg-ink-950 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-white">New Swiss tournament</h2>
          <button onClick={onClose} className="text-2xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        <div className="space-y-3 text-sm">
          <FormRow label="Tournament name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chennai Weekend Open"
                   className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white outline-none focus:border-brand-500" />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="City"><input value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white" /></FormRow>
            <FormRow label="Start date"><input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="YYYY/MM/DD" className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white" /></FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Rounds"><input type="number" min={1} max={20} value={numRounds} onChange={(e) => setNumRounds(+e.target.value)} className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white" /></FormRow>
            <FormRow label="Rating type">
              <select value={ratingType} onChange={(e) => setRatingType(e.target.value)} className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white">
                <option value="UNRATED">Unrated</option>
                <option value="STATE">State</option>
                <option value="AICF">AICF</option>
                <option value="FIDE">FIDE</option>
              </select>
            </FormRow>
          </div>
          <FormRow label="Board 1 color (first round)">
            <select value={firstColor} onChange={(e) => setFirstColor(e.target.value as any)} className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white">
              <option value="white1">Top seed plays WHITE</option>
              <option value="black1">Top seed plays BLACK</option>
              <option value="rank">By rank / random</option>
            </select>
          </FormRow>
          <FormRow label="Chief arbiter (optional)">
            <input value={chief} onChange={(e) => setChief(e.target.value)} className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white" />
          </FormRow>
          {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}
          <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}
                  className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {create.isPending ? "Creating…" : "Create tournament →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      {children}
    </label>
  );
}

// ═══════════════ /arbiter/:id — one tournament ═══════════════

function ArbiterDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["arbiter", "one", id],
    queryFn: () => get<Tournament & { error?: string }>(`/api/pairings/tournaments/${id}`),
    refetchInterval: 15_000,
  });
  const [tab, setTab] = useState<"players" | "rounds" | "standings" | "publish">("players");

  if (isLoading) return <div className="mx-auto max-w-6xl py-10 text-center text-ink-400">Loading…</div>;
  if (error || (data as any)?.error) return (
    <div className="mx-auto max-w-2xl py-10 text-center">
      <div className="text-2xl">🔒</div>
      <div className="mt-2 font-semibold">{(data as any)?.error || "Failed to load."}</div>
      <Link to="/arbiter" className="mt-4 inline-block text-brand-400">← Back</Link>
    </div>
  );
  const t = data as Tournament;
  const nextRoundNo = t.rounds.length + 1;
  const canPair = t.players.length >= 2 && t.rounds.length < t.num_rounds;

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      <header>
        <Link to="/arbiter" className="text-xs text-ink-400 hover:text-brand-400">← All tournaments</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-white">{t.name}</h1>
            <div className="mt-1 text-xs text-ink-400">
              {t.city || "—"} · {t.rating_type} · {t.num_rounds} rounds · {t.players.length} players
              {t.cr_sid && <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">chess-results.com #{t.cr_tournament}</span>}
            </div>
          </div>
          <a href={`/api/pairings/tournaments/${t._id}/trf16`} target="_blank" rel="noopener"
             className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800">
            ⬇ TRF16 (for AICF/FIDE)
          </a>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-ink-700">
        {(["players", "rounds", "standings", "publish"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-2 text-sm font-semibold transition ${tab === k ? "border-b-2 border-brand-500 text-white" : "text-ink-400 hover:text-white"}`}>
            {k === "players" ? `Players (${t.players.length})`
              : k === "rounds"   ? `Rounds (${t.rounds.length}/${t.num_rounds})`
              : k === "standings" ? "Standings"
              : t.cr_sid ? "chess-results ✓" : "Publish"}
          </button>
        ))}
      </nav>

      {tab === "players" && <PlayersTab t={t} onChange={() => qc.invalidateQueries({ queryKey: ["arbiter", "one", id] })} />}
      {tab === "rounds" && (
        <RoundsTab t={t} canPair={canPair} nextRoundNo={nextRoundNo}
                   onChange={() => qc.invalidateQueries({ queryKey: ["arbiter", "one", id] })} />
      )}
      {tab === "standings" && <StandingsTab t={t} />}
      {tab === "publish" && <PublishTab t={t} onChange={() => qc.invalidateQueries({ queryKey: ["arbiter", "one", id] })} />}
    </div>
  );
}

// ═══════════════ Players tab ═══════════════

function PlayersTab({ t, onChange }: { t: Tournament; onChange: () => void }) {
  const [csv, setCsv] = useState("");
  const [name, setName] = useState("");
  const [rating, setRating] = useState<number | "">("");
  const [fed, setFed] = useState("IND");
  const [fideId, setFideId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const locked = t.rounds.length > 0;

  const addOne = useMutation({
    mutationFn: () => post<{ ok: boolean; total?: number; error?: string }>(`/api/pairings/tournaments/${t._id}/players`, {
      players: [{ name, rating: rating || 0, federation: fed, fide_id: fideId }],
    }),
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error || "Add failed"); return; }
      setName(""); setRating(""); setFideId(""); onChange();
    },
  });

  const importCsv = useMutation({
    mutationFn: () => {
      const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const players = rows.map((row) => {
        const [nm, rt, fd, fid] = row.split(/[,\t;]/).map((s) => s.trim());
        return { name: nm, rating: +(rt || 0), federation: fd || "IND", fide_id: fid || "" };
      }).filter((p) => p.name);
      return post<{ ok: boolean; added?: number; total?: number; error?: string }>(`/api/pairings/tournaments/${t._id}/players`, { players });
    },
    onSuccess: (r) => { setMsg(r.ok ? `Added ${r.added} — total ${r.total}` : (r.error || "Import failed")); if (r.ok) { setCsv(""); onChange(); } },
  });

  const remove = useMutation({
    mutationFn: (rank: number) => deleteJson<{ ok: boolean }>(`/api/pairings/tournaments/${t._id}/players/${rank}`),
    onSuccess: () => onChange(),
  });

  return (
    <div className="space-y-6">
      {locked && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Round 1 already paired — player roster is locked to preserve pairing history.
        </div>
      )}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Add one player</h3>
          <div className="space-y-2">
            <input disabled={locked} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lastname, Firstname"
                   className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white disabled:opacity-50" />
            <div className="grid grid-cols-3 gap-2">
              <input disabled={locked} value={rating} onChange={(e) => setRating(e.target.value ? +e.target.value : "")} type="number" placeholder="Rating"
                     className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white disabled:opacity-50" />
              <input disabled={locked} value={fed} onChange={(e) => setFed(e.target.value.slice(0, 3).toUpperCase())} placeholder="IND"
                     className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white disabled:opacity-50" />
              <input disabled={locked} value={fideId} onChange={(e) => setFideId(e.target.value)} placeholder="FIDE ID"
                     className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white disabled:opacity-50" />
            </div>
            <button disabled={locked || !name.trim() || addOne.isPending} onClick={() => addOne.mutate()}
                    className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {addOne.isPending ? "Adding…" : "+ Add player"}
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-5">
          <h3 className="mb-2 text-sm font-semibold text-white">Import CSV/paste</h3>
          <div className="mb-2 text-[11px] text-ink-400">One player per line: <code>Name, Rating, Fed, FIDE-ID</code></div>
          <textarea disabled={locked} value={csv} onChange={(e) => setCsv(e.target.value)} rows={5}
                    placeholder="Anand, Viswanathan, 2751, IND, 5000017&#10;Praggnanandhaa, R, 2734, IND, 25059530"
                    className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-white disabled:opacity-50" />
          <button disabled={locked || !csv.trim() || importCsv.isPending} onClick={() => importCsv.mutate()}
                  className="w-full rounded-lg border border-ink-700 bg-ink-800 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {importCsv.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </section>
      {msg && <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-300">{msg}</div>}

      <div className="overflow-x-auto rounded-2xl border border-ink-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-900 text-xs uppercase tracking-wider text-ink-400">
            <tr>{["#", "Name", "Rating", "Fed", "FIDE ID", ""].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {t.players.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-400">No players yet.</td></tr>
            ) : t.players.map((p) => (
              <tr key={p.rank} className="border-t border-ink-700 hover:bg-ink-900/60">
                <td className="px-3 py-2 font-mono text-ink-400">{p.rank}</td>
                <td className="px-3 py-2 font-semibold text-white">{p.name}</td>
                <td className="px-3 py-2">{p.rating || "—"}</td>
                <td className="px-3 py-2">{p.federation}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-400">{p.fide_id || "—"}</td>
                <td className="px-3 py-2 text-right">
                  {!locked && (
                    <button onClick={() => { if (confirm(`Remove ${p.name}?`)) remove.mutate(p.rank); }}
                            className="text-xs text-rose-400 hover:text-rose-300">Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════ Rounds tab ═══════════════

function RoundsTab({ t, canPair, nextRoundNo, onChange }: { t: Tournament; canPair: boolean; nextRoundNo: number; onChange: () => void }) {
  const [pairingErr, setPairingErr] = useState<string | null>(null);
  const nameByRank = useMemo(() => Object.fromEntries(t.players.map((p) => [p.rank, p.name])), [t.players]);

  const pair = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; round?: Round }>(`/api/pairings/tournaments/${t._id}/pair-round`, {}),
    onSuccess: (r) => { if (!r.ok) setPairingErr(r.error || "Pairing failed"); else { setPairingErr(null); onChange(); } },
  });
  const setResult = useMutation({
    mutationFn: (v: { round: number; board: number; result: string | null }) =>
      post<{ ok: boolean; cr_push?: any }>(`/api/pairings/tournaments/${t._id}/rounds/${v.round}/result`, { board: v.board, result: v.result }),
    onSuccess: () => onChange(),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-700 bg-ink-900/40 p-4">
        <div>
          <div className="text-sm font-semibold text-white">Round {nextRoundNo} of {t.num_rounds}</div>
          <div className="mt-0.5 text-xs text-ink-400">
            {t.rounds.length === 0 ? "Ready to pair round 1 — top-half vs bottom-half by rating." : `Fill all results in round ${t.rounds.length} before pairing round ${nextRoundNo}.`}
          </div>
        </div>
        <button disabled={!canPair || pair.isPending} onClick={() => pair.mutate()}
                className="rounded-xl bg-gradient-to-r from-brand-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {pair.isPending ? "JaVaFo pairing…" : `Pair round ${nextRoundNo} →`}
        </button>
      </div>
      {pairingErr && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{pairingErr}</div>}

      {t.rounds.length === 0 ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-8 text-center text-ink-400">No rounds paired yet. Add players in the Players tab first.</div>
      ) : (
        [...t.rounds].reverse().map((r) => (
          <section key={r.round_no} className="rounded-2xl border border-ink-700 bg-ink-900/40">
            <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Round {r.round_no}</h3>
              <div className="text-xs text-ink-400">{r.pairings.length} board{r.pairings.length === 1 ? "" : "s"} · generated {new Date(r.generated_at).toLocaleString()}</div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-ink-400">
                  <tr><th className="px-3 py-2 text-left font-semibold">Bd</th><th className="px-3 py-2 text-right font-semibold">#</th><th className="px-3 py-2 text-left font-semibold">White</th><th className="px-3 py-2 text-center font-semibold">Result</th><th className="px-3 py-2 text-left font-semibold">Black</th><th className="px-3 py-2 text-left font-semibold">#</th><th className="px-3 py-2 text-left font-semibold text-[10px]">CR</th></tr>
                </thead>
                <tbody>
                  {r.pairings.map((g) => (
                    <tr key={g.board} className="border-t border-ink-700">
                      <td className="px-3 py-2 font-mono text-ink-400">{g.board}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-400">{g.white_rank}</td>
                      <td className="px-3 py-2 font-semibold text-white">{nameByRank[g.white_rank] || "?"}</td>
                      <td className="px-3 py-2 text-center">
                        {g.black_rank === 0 ? <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-400">bye</span> : (
                          <select value={g.result || ""} onChange={(e) => setResult.mutate({ round: r.round_no, board: g.board, result: e.target.value || null })}
                                  className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-white">
                            <option value="">— pending —</option>
                            <option value="1">1-0</option>
                            <option value="=">½-½</option>
                            <option value="0">0-1</option>
                            <option value="+">+:-</option>
                            <option value="-">-:+</option>
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-white">{g.black_rank ? (nameByRank[g.black_rank] || "?") : "—"}</td>
                      <td className="px-3 py-2 font-mono text-ink-400">{g.black_rank || ""}</td>
                      <td className="px-3 py-2 text-[10px]">
                        {g.cr_pushed ? (
                          <span className={g.cr_pushed.status === "OK" ? "text-emerald-400" : "text-amber-400"} title={g.cr_pushed.msg}>
                            {g.cr_pushed.status === "OK" ? "✓" : "!"}
                          </span>
                        ) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// ═══════════════ Standings tab ═══════════════

function StandingsTab({ t }: { t: Tournament }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-ink-900 text-xs uppercase tracking-wider text-ink-400">
          <tr>{["Place", "Name", "Rtg", "Pts", "Bh", "SB"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.standings.map((s) => (
            <tr key={s.rank} className="border-t border-ink-700">
              <td className="px-3 py-2 font-mono text-ink-400">{s.place}</td>
              <td className="px-3 py-2 font-semibold text-white">{s.name}</td>
              <td className="px-3 py-2 text-ink-400">{s.rating || "—"}</td>
              <td className="px-3 py-2 font-mono text-white">{s.points.toFixed(1)}</td>
              <td className="px-3 py-2 font-mono text-ink-400">{s.buchholz.toFixed(1)}</td>
              <td className="px-3 py-2 font-mono text-ink-400">{s.sb.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-ink-700 bg-ink-900/60 px-4 py-3 text-[11px] text-ink-400">
        Tiebreaks: Buchholz (sum of opponents' points), then Sonneborn-Berger (Buchholz weighted by result vs each opp), then rating.
      </div>
    </div>
  );
}

// ═══════════════ Publish tab ═══════════════

function PublishTab({ t, onChange }: { t: Tournament; onChange: () => void }) {
  const [sid, setSid] = useState(t.cr_sid || "");
  const [tn, setTn] = useState(t.cr_tournament || "");
  const [msg, setMsg] = useState<string | null>(null);
  const publish = useMutation({
    mutationFn: () => post<{ ok: boolean; matched?: number; total_players?: number; uid_map_available?: boolean; error?: string }>(
      `/api/pairings/tournaments/${t._id}/publish`, { sid, tournament: tn }),
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error || "Publish failed"); return; }
      setMsg(r.uid_map_available
        ? `Linked. Matched ${r.matched} of ${r.total_players} players by starting rank. Future results auto-push to chess-results.com.`
        : `SID saved but chess-results.com uid-map fetch failed — result push will work once uids are matched. Retry after players are visible on chess-results.com.`);
      onChange();
    },
  });
  const togglePublic = useMutation({
    mutationFn: (is_public: boolean) => post<{ ok: boolean; is_public: boolean }>(`/api/pairings/tournaments/${t._id}/public`, { is_public }),
    onSuccess: () => onChange(),
  });
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-white">Publish on results.chessguru.cc</h3>
            <p className="mt-1 text-xs text-ink-400">
              When enabled, this tournament appears at{" "}
              <a href={t.is_public ? `https://results.chessguru.cc/t/${t._id}` : "https://results.chessguru.cc/"}
                 target="_blank" rel="noopener" className="text-brand-400 hover:underline">
                results.chessguru.cc/t/{t._id.slice(-8)}
              </a>{" "}
              — crosstable, standings, and round pairings visible to anyone, no login required.
              SEO-indexed so players + parents find their results on Google.
            </p>
          </div>
          <label className="flex flex-none cursor-pointer items-center gap-2">
            <input type="checkbox" checked={!!t.is_public} disabled={togglePublic.isPending}
                   onChange={(e) => togglePublic.mutate(e.target.checked)}
                   className="h-5 w-5 accent-emerald-500" />
            <span className="text-sm font-semibold text-white">{t.is_public ? "Public" : "Private"}</span>
          </label>
        </div>
        {t.is_public && (
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`https://results.chessguru.cc/t/${t._id}`} target="_blank" rel="noopener"
               className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110">
              Open public page ↗
            </a>
            <button onClick={() => { navigator.clipboard.writeText(`https://results.chessguru.cc/t/${t._id}`); }}
                    className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800">
              Copy public link
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-ink-700 bg-ink-900/40 p-5 text-sm">
        <h3 className="mb-1 font-semibold text-white">Publish to chess-results.com (optional)</h3>
        <p className="mb-3 text-xs text-ink-400">
          Once a tournament is created on chess-results.com (via any Swiss Manager or by request to Heinz Herzog),
          paste the <b>Security ID</b> (32-char hex) and <b>Tournament number</b> below. All result entries in ChessGuru will then
          auto-push to chess-results.com in the background.
        </p>
        <div className="space-y-2">
          <FormRow label="Security ID (SID)">
            <input value={sid} onChange={(e) => setSid(e.target.value.toUpperCase())} maxLength={32} placeholder="5422254B63F63E1CBB6906E4DA26F3FC"
                   className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-white" />
          </FormRow>
          <FormRow label="chess-results.com tournament number">
            <input value={tn} onChange={(e) => setTn(e.target.value.replace(/\D/g, ""))} placeholder="27289"
                   className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-white" />
          </FormRow>
          <button disabled={sid.length !== 32 || !tn || publish.isPending} onClick={() => publish.mutate()}
                  className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {publish.isPending ? "Linking…" : t.cr_sid ? "Re-link" : "Link tournament"}
          </button>
          {msg && <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-300">{msg}</div>}
        </div>
      </section>
      <section className="rounded-2xl border border-ink-700 bg-ink-900/40 p-5 text-sm">
        <h3 className="mb-1 font-semibold text-white">FIDE / AICF rating submission</h3>
        <p className="mb-3 text-xs text-ink-400">
          Download the TRF16 file below and email it to the rating officer:
        </p>
        <ul className="mb-3 space-y-1 text-xs text-ink-400">
          <li>• AICF: <span className="font-mono text-brand-300">office@aicf.in</span></li>
          <li>• FIDE (via national federation): use your NCA rating officer</li>
        </ul>
        <a href={`/api/pairings/tournaments/${t._id}/trf16`} target="_blank" rel="noopener"
           className="inline-block rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-800">
          ⬇ Download {t.slug}.trfx
        </a>
      </section>
    </div>
  );
}
