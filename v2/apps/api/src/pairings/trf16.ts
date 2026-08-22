// FIDE TRF16 encoder + decoder — the canonical FIDE Tournament Report File
// format (Handbook C.04 Annex 2). Columns are fixed-width and position-critical:
// JaVaFo parses byte-offsets to identify fields, so a stray space anywhere in
// cols 1-89 breaks the pairing engine.
//
// This file only handles the SUBSET we need for JaVaFo pairing input + FIDE
// rating submission: single-tournament Swiss, individual (not team). Team,
// accelerated brackets, and forbidden-pairs extensions can be layered on later.

export interface TrfPlayer {
  rank: number;              // starting rank 1..9999
  sex?: "m" | "w" | null;
  title?: string | null;     // GM/IM/FM/CM/WGM/WIM/WFM/WCM/blank
  name: string;              // "Lastname, Firstname" (≤33 chars)
  rating?: number | null;    // FIDE rating, 0 for unrated
  federation?: string | null; // 3-letter IOC code (IND, USA, etc.)
  fide_id?: string | null;   // up to 11 digits
  birth?: string | null;     // YYYY/MM/DD
}

export interface TrfRoundEntry {
  opp_rank: number;          // opponent starting rank; 0 = bye/absent
  color: "w" | "b" | null;
  result: TrfResult | null;
}

// Result codes per TRF16 col 99 spec. `null` = round not yet played (JaVaFo
// will pair players whose latest round has a null result).
export type TrfResult = "1" | "=" | "0" | "+" | "-" | "H" | "F" | "U" | "Z" | "W" | "D" | "L";

export interface TrfTournament {
  name: string;
  city?: string;
  federation?: string;       // e.g., IND
  start_date?: string;       // YYYY/MM/DD
  end_date?: string;
  chief_arbiter?: string;
  time_control?: string;
  num_rounds: number;
  first_color?: "white1" | "black1" | "rank" | null;
  players: TrfPlayer[];
  // rounds[playerRank-1][roundIdx] — completed rounds only. Round being paired
  // (the "current" round) is omitted from this array.
  history?: TrfRoundEntry[][];
  // per-player points so far (col 81-84). If omitted we compute from history
  // using 1/0.5/0 scoring.
  points?: number[];
}

// Build one column-perfect 001 line. Columns are 1-based per FIDE spec; we
// work in 0-based indices internally and convert at the end.
function buildPlayerLine(p: TrfPlayer, points: number, roundHistory: TrfRoundEntry[]): string {
  // Base line is 89 chars (through Rank col 89). We then append round columns
  // starting at col 92 with 10-column strides.
  const buf: string[] = new Array(89).fill(" ");
  const put = (col1: number, w: number, s: string, right = false) => {
    const t = s.length > w ? s.slice(0, w) : right ? s.padStart(w, " ") : s.padEnd(w, " ");
    for (let i = 0; i < w; i++) buf[col1 - 1 + i] = t[i] || " ";
  };
  put(1, 3, "001");
  put(5, 4, String(p.rank), true);
  buf[10 - 1] = p.sex === "w" ? "w" : p.sex === "m" ? "m" : " ";
  put(11, 3, p.title || "");
  put(15, 33, p.name || "");
  put(49, 4, p.rating != null ? String(p.rating) : "", true);
  put(54, 3, p.federation || "");
  put(58, 11, p.fide_id || "");
  put(70, 10, p.birth || "");
  put(81, 4, points.toFixed(1), true);
  put(86, 4, String(p.rank), true); // rank same as startrank pre-standings; JaVaFo doesn't use this field for pairing
  let line = buf.join("");

  // Append per-round data: cols 92-95 opp, 97 color, 99 result. Rounds are
  // separated by a single space so col alignment holds (round R starts at
  // col 92 + (R-1)*10).
  for (let r = 0; r < roundHistory.length; r++) {
    const entry = roundHistory[r];
    if (!entry) continue;
    const rBuf: string[] = new Array(10).fill(" ");
    const oppStr = entry.opp_rank ? String(entry.opp_rank).padStart(4, " ") : "0000";
    for (let i = 0; i < 4; i++) rBuf[2 + i] = oppStr[i] || " ";
    rBuf[7] = entry.color || "-";
    rBuf[9] = entry.result || " ";
    line += rBuf.join("");
  }
  return line;
}

/** Encode a tournament into TRF(x) text ready to hand to JaVaFo. */
export function encodeTrf(t: TrfTournament): string {
  const rows: string[] = [];
  if (t.name) rows.push("012 " + t.name);
  if (t.city) rows.push("022 " + t.city);
  if (t.federation) rows.push("032 " + t.federation);
  if (t.start_date) rows.push("042 " + t.start_date);
  if (t.end_date) rows.push("052 " + t.end_date);
  rows.push("062 " + t.players.length);
  rows.push("092 Individual: Swiss-System");
  if (t.chief_arbiter) rows.push("102 " + t.chief_arbiter);
  if (t.time_control) rows.push("122 " + t.time_control);
  // JaVaFo extension: number of rounds
  rows.push("XXR " + t.num_rounds);
  // First-round color choice — optional but recommended
  if (t.first_color) rows.push("XXC " + t.first_color);

  // Per-player points (computed if not passed)
  const history = t.history || t.players.map(() => []);
  const points = t.points || history.map((h) =>
    h.reduce((sum, e) => sum + (e.result === "1" || e.result === "+" || e.result === "W" || e.result === "U" || e.result === "F" ? 1
                              : e.result === "=" || e.result === "D" || e.result === "H" ? 0.5
                              : 0), 0)
  );

  for (const p of t.players) {
    rows.push(buildPlayerLine(p, points[p.rank - 1] ?? 0, history[p.rank - 1] ?? []));
  }
  return rows.join("\n") + "\n";
}

/** Parse the plain-text pairings JaVaFo emits.
 *  Line 1 = number of pairs, followed by "white black" per line ("N 0" = bye). */
export interface ParsedPair { board: number; white: number; black: number; }
export function parseJavafoOutput(text: string): ParsedPair[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0];
  if (!first) return [];
  const p = parseInt(first, 10);
  if (!Number.isFinite(p) || p <= 0) return [];
  const out: ParsedPair[] = [];
  for (let i = 1; i <= p && i < lines.length; i++) {
    const parts = (lines[i] || "").split(/\s+/).map((n) => parseInt(n, 10));
    const w = parts[0], b = parts[1];
    if (Number.isFinite(w)) out.push({ board: i, white: w as number, black: (b as number) || 0 });
  }
  return out;
}
