// chess-results.com XML upload client. Herzog's 2014 protocol (see
// XML_interface_for_results.pdf) — POST to xml.aspx?key1=UpdResult with
// x-www-form-urlencoded body containing an `xml` field. Angle brackets must
// be substituted for {} because the site's WAF rejects raw <> in POST bodies.
//
// Prerequisites the tournament creator must obtain from Swiss Manager (or by
// contacting Herzog for a non-SM tournament):
//   • sid: 32-char security ID (Swiss Manager: Internet menu → Customize lists)
//   • tournament: numeric tournament number (from URL /test/tnrNNNNNN.aspx)
//   • per-player cr_uid: chess-results.com's internal player id; fetched via
//     GET http://chess-results.com/test/xml.aspx?tnr=<TN>&key1=Alphabetic
//
// We do NOT own the tournament creation handshake — that is SM-exclusive.
// This module only pushes round results.

const CR_ENDPOINT = "http://chess-results.com/xml.aspx?key1=UpdResult";

export type CrResult = "1" | "x" | "0" | "+" | "-" | "D";

export function toCrResult(trf: string): CrResult | null {
  switch (trf) {
    case "1": return "1";
    case "=": return "x";
    case "0": return "0";
    case "+": return "+";
    case "-": return "-";
    default: return null; // W/D/L (forfeit variants), H, F, U, Z — skip
  }
}

// Sanitize per Herzog's spec: swap < > for { } before POST.
function escapeXml(s: string): string {
  return s.replace(/</g, "{").replace(/>/g, "}");
}

export interface UploadPayload {
  sid: string;
  tournament: string;
  round: number;
  cr_uid: number;      // white player's chess-results uid
  result: CrResult;
}

export interface UploadResult {
  ok: boolean;
  status: "OK" | "WARNING" | "ERROR" | "NETWORK";
  msg: string;
}

/** Push one game result to chess-results.com. */
export async function uploadResult(p: UploadPayload): Promise<UploadResult> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Pairing><data sid="${p.sid}" Tournament="${p.tournament}" Round="${p.round}" Uid="${p.cr_uid}" Result="${p.result}"/></Pairing>`;
  const body = new URLSearchParams({ xml: escapeXml(xml) });
  try {
    const res = await fetch(CR_ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const text = await res.text();
    // Response is XML: <UpdatePairing><data status="OK" statusMsg="..."/></UpdatePairing>
    const status = /status="([^"]+)"/i.exec(text)?.[1] as UploadResult["status"] || "ERROR";
    const msg = /statusMsg="([^"]+)"/i.exec(text)?.[1] || text.slice(0, 200);
    return { ok: status === "OK", status, msg };
  } catch (e: any) {
    return { ok: false, status: "NETWORK", msg: e?.message || String(e) };
  }
}

/** Fetch chess-results.com's uid map for a tournament. Returns { startRank → cr_uid } */
export async function fetchUidMap(tournament: string): Promise<Record<number, number> | null> {
  try {
    const res = await fetch(`http://chess-results.com/test/xml.aspx?tnr=${encodeURIComponent(tournament)}&key1=Alphabetic`);
    const text = await res.text();
    // The response format is XML with <player StartRank="N" Uid="M" .../>. Regex-lift is
    // fine here — the format is fixed and small.
    const out: Record<number, number> = {};
    const re = /StartRank="(\d+)"[^>]*Uid="(\d+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out[+(m[1] || 0)] = +(m[2] || 0);
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
