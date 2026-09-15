// Academy → WhatsApp (owner 2026-09-15). Every message this academy has sent to, or received
// from, a parent — grouped by number, laid out like WhatsApp itself so it needs no explaining.
//
// Reads are scoped server-side to the caller's own academyId, so an academy can only ever see
// its own threads. The server also resolves each number to the person behind it (a parent and
// the children this academy teaches, a student, or a lead), which is what turns a list of
// digits into a contact list.
//
// Messages go out from the shared ChessGuru number, so the academy stamp lives on the row
// rather than on the sending identity. A reply threads back to whichever academy last
// messaged that number (see whatsapp.service handleWebhook).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

type Contact = {
  name: string | null;
  username: string | null;
  role: string | null;
  students: string[];
  parents: string[];
};
type Thread = {
  _id: string;                 // the parent's number, E.164 without +
  lastAt: string | null;
  lastText?: string | null;
  lastTemplate?: string | null;
  lastBody?: string | null;
  lastDirection: "in" | "out";
  count: number;
  contact?: Contact | null;
};
type Message = {
  _id: string;
  direction: "in" | "out";
  to?: string; from?: string;
  template?: string | null;
  values?: string[];
  text?: string | null;
  body?: string | null;     // the template rendered with its values — what the parent saw
  status?: string | null;
  error?: string | null;
  sentAt?: string | null;
  receivedAt?: string | null;
};

/* ---------- names, numbers and times ---------- */

const prettyNumber = (n: string) =>
  n?.length === 12 && n.startsWith("91") ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : n ? `+${n}` : "—";

/** What to call this thread. A named person wins; otherwise the number stands in for itself. */
const titleOf = (t: Pick<Thread, "_id" | "contact">) => t.contact?.name || prettyNumber(t._id);

/** The line under the name: who they are to the academy, then the number. Always ends with the
 *  number, because that is the one thing that is always true and always useful. */
function subtitleOf(t: Pick<Thread, "_id" | "contact">): string {
  const c = t.contact;
  const num = prettyNumber(t._id);
  if (!c) return `Not in your contacts · ${num}`;
  if (c.role === "parent") {
    return c.students.length
      ? `Parent of ${c.students.join(", ")} · ${num}`
      : `Parent · ${num}`;
  }
  if (c.role === "student") {
    return c.parents.length ? `Student · parent ${c.parents.join(", ")} · ${num}` : `Student · ${num}`;
  }
  if (c.role === "lead") return `Lead · ${num}`;
  if (c.role) return `${c.role.replace(/_/g, " ")} · ${num}`;
  return num;
}

const initialsOf = (label: string) => {
  const words = label.replace(/^\+?\d[\d ]*$/, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "#";
  return ((words[0]?.[0] ?? "#") + (words[1]?.[0] ?? "")).toUpperCase();
};

/** A stable colour per contact, so the same person keeps the same avatar between visits. */
const AVATAR_HUES = ["#6b7c85", "#0f6b5c", "#7a5c3e", "#5b5e8a", "#7a4a5e", "#3f6b8a", "#6b6330"];
const hueOf = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
};

const clockOf = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "";

/** WhatsApp's list stamp: time today, "Yesterday", then the date. */
function stampOf(d: string | null | undefined) {
  if (!d) return "";
  const at = new Date(d);
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(at).getTime()) / 86_400_000);
  if (days === 0) return clockOf(d);
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function daySeparator(d: string | null | undefined) {
  if (!d) return "";
  const at = new Date(d);
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(at).getTime()) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  return at.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
}

const atOf = (m: Message) => m.sentAt ?? m.receivedAt ?? null;
const peerOf = (m: Message) => m.to ?? m.from ?? "";

/** The message as the parent read it. The server renders a template's body with its merge
 *  values; we only fall back to naming the template if that definition has since been removed. */
function describe(m: Pick<Message, "text" | "template" | "values" | "body">) {
  if (m.body) return m.body;
  if (m.text) return m.text;
  if (m.template) return `Template “${m.template}”${m.values?.length ? ` · ${m.values.join(" · ")}` : ""}`;
  return "(no content)";
}

/* ---------- delivery ticks ---------- */

/** WhatsApp's own vocabulary: one tick sent, two delivered, two blue read. A failure is the one
 *  state WhatsApp shows in words rather than ticks, because it needs acting on. */
function Ticks({ status, onGreen = false }: { status?: string | null; onGreen?: boolean }) {
  const s = String(status ?? "");
  if (s === "failed" || s === "error") return <span className="text-[11px] font-semibold text-rose-300">failed</span>;
  const read = s === "read";
  const double = read || s === "delivered";
  return (
    <svg viewBox="0 0 18 12" aria-label={s || "sent"} className="h-3 w-[18px] shrink-0"
         fill="none" stroke={read ? "#53bdeb" : onGreen ? "#a8c8bf" : "#8696a0"} strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,6.5 4.5,10 11,2.5" />
      {double && <polyline points="7,10 13.5,2.5" />}
    </svg>
  );
}

function Avatar({ label, seed, size = 49 }: { label: string; seed: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white/90 select-none"
      style={{ width: size, height: size, background: hueOf(seed), fontSize: size * 0.36 }}
    >
      {initialsOf(label)}
    </div>
  );
}

/* ---------- page ---------- */

export default function AcademyWhatsAppPage() {
  const [peer, setPeer] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { document.title = "WhatsApp · ChessGuru"; }, []);

  const threads = useQuery({
    queryKey: ["academy-wa-threads"],
    queryFn: () => get<{ ok: boolean; configured: boolean; threads: Thread[] }>("/api/academy/whatsapp/threads"),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
  const messages = useQuery({
    queryKey: ["academy-wa-messages"],
    queryFn: () => get<{ ok: boolean; messages: Message[] }>("/api/academy/whatsapp/messages?limit=300"),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const all = threads.data?.threads ?? [];
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((t) =>
      `${titleOf(t)} ${subtitleOf(t)} ${t._id} ${t.contact?.students.join(" ") ?? ""}`.toLowerCase().includes(needle));
  }, [all, q]);

  const selected = peer && list.some((t) => t._id === peer) ? peer : list[0]?._id ?? null;
  const active = list.find((t) => t._id === selected) ?? null;

  const thread = useMemo(
    () => (messages.data?.messages ?? [])
      .filter((m) => peerOf(m) === selected)
      .sort((a, b) => +new Date(atOf(a) ?? 0) - +new Date(atOf(b) ?? 0)),
    [messages.data, selected],
  );

  const loading = threads.isLoading || messages.isLoading;
  const err = (threads.error ?? messages.error) as any;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Academy</div>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">WhatsApp</h1>
          <p className="mt-1 text-sm text-ink-400">Messages sent to your parents, and their replies.</p>
        </div>
        <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
      </div>

      {threads.data && !threads.data.configured && (
        <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          WhatsApp is not connected yet. Nothing can be sent or received until ChessGuru finishes the setup.
        </div>
      )}
      {err && (
        <div className="mb-5 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {err?.message || "Could not load your messages."}
        </div>
      )}
      {loading && <div className="text-sm text-ink-400">Loading…</div>}

      {!loading && !err && all.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-8 text-center">
          <div className="font-display text-xl font-bold text-white">No messages yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">
            When your academy sends a fee reminder or a class notice on WhatsApp, it will appear
            here along with anything the parent replies.
          </p>
        </div>
      )}

      {!loading && !err && all.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-black/40 shadow-2xl shadow-black/40">
          <div className="grid h-[70vh] min-h-[520px] grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">

            {/* ── chat list ─────────────────────────────────────────── */}
            <aside className="flex min-h-0 flex-col border-r border-[#222d34] bg-[#111b21]">
              <div className="flex items-center gap-3 bg-[#202c33] px-4 py-3">
                <span className="text-sm font-semibold text-[#e9edef]">Chats</span>
                <span className="rounded-full bg-[#2a3942] px-2 py-0.5 text-[11px] font-medium text-[#8696a0]">
                  {all.length}
                </span>
              </div>
              <div className="bg-[#111b21] px-3 py-2">
                <div className="flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-1.5">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#8696a0]" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name, student or number"
                    className="w-full bg-transparent py-1 text-[13px] text-[#e9edef] placeholder:text-[#8696a0] focus:outline-none"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {list.length === 0 && (
                  <div className="px-4 py-8 text-center text-[13px] text-[#8696a0]">No chat matches “{q}”.</div>
                )}
                {list.map((t) => {
                  const on = t._id === selected;
                  const title = titleOf(t);
                  return (
                    <button
                      key={t._id}
                      onClick={() => setPeer(t._id)}
                      className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition ${on ? "bg-[#2a3942]" : "hover:bg-[#202c33]"}`}
                    >
                      <Avatar label={title} seed={t._id} />
                      <span className="min-w-0 flex-1 border-b border-[#222d34] pb-2.5">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] text-[#e9edef]">{title}</span>
                          <span className="shrink-0 text-[11px] text-[#8696a0] tabular-nums">{stampOf(t.lastAt)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[13px] text-[#8696a0]">
                          {t.lastDirection === "out" && <Ticks status="sent" />}
                          <span className="truncate">
                            {describe({ text: t.lastText, template: t.lastTemplate, body: t.lastBody, values: [] })}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#667781]">{subtitleOf(t)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* ── conversation ──────────────────────────────────────── */}
            <section className="flex min-h-0 flex-col bg-[#0b141a]">
              {active && (
                <header className="flex items-center gap-3 border-b border-[#222d34] bg-[#202c33] px-4 py-2.5">
                  <Avatar label={titleOf(active)} seed={active._id} size={40} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium text-[#e9edef]">{titleOf(active)}</div>
                    <div className="truncate text-[12px] text-[#8696a0]">{subtitleOf(active)}</div>
                  </div>
                </header>
              )}

              {/* WhatsApp's wallpaper, as a woven tint rather than a doodle bitmap */}
              <div
                className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4 md:px-10"
                style={{
                  backgroundColor: "#0b141a",
                  backgroundImage:
                    "radial-gradient(#1b2730 1px, transparent 1px), radial-gradient(#161f26 1px, transparent 1px)",
                  backgroundSize: "28px 28px, 28px 28px",
                  backgroundPosition: "0 0, 14px 14px",
                }}
              >
                {thread.map((m, i) => {
                  const out = m.direction === "out";
                  const sep = daySeparator(atOf(m));
                  const prev = thread[i - 1];
                  const showSep = !prev || sep !== daySeparator(atOf(prev));
                  return (
                    <div key={m._id}>
                      {showSep && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-lg bg-[#182229] px-3 py-1 text-[11px] font-medium tracking-wide text-[#8696a0] shadow">
                            {sep}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-[14.2px] leading-[19px] shadow-sm ${
                            out ? "rounded-tr-none bg-[#005c4b] text-[#e9edef]" : "rounded-tl-none bg-[#202c33] text-[#e9edef]"
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words">
                            {describe(m)}
                            {m.error ? (
                              <span className="mt-1 block text-[11px] text-rose-300">
                                {m.error}
                                <span className={out ? "inline-block w-[82px]" : "inline-block w-[58px]"} aria-hidden="true" />
                              </span>
                            ) : (
                              <span className={out ? "inline-block w-[82px]" : "inline-block w-[58px]"} aria-hidden="true" />
                            )}
                          </div>
                          <div className={`absolute bottom-1.5 right-2.5 flex items-center gap-1 text-[11px] ${out ? "text-[#a8c8bf]" : "text-[#8696a0]"}`}>
                            <span className="tabular-nums">{clockOf(atOf(m))}</span>
                            {out && <Ticks status={m.status} onGreen />}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {thread.length === 0 && (
                  <div className="pt-10 text-center text-[13px] text-[#8696a0]">Nothing in this conversation yet.</div>
                )}
              </div>

              <div className="border-t border-[#222d34] bg-[#202c33] px-4 py-2.5 text-[11px] text-[#8696a0]">
                Sent from the ChessGuru WhatsApp number on your academy's behalf, so parents see
                ChessGuru as the sender.
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
