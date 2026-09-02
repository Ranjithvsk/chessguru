// /messages — direct 1:1 messaging between academy members (owner ask
// 2026-09-02). WhatsApp-style layout: contact list on the left, active
// thread on the right. Polls every 8s for new messages + fresh unread
// counts. Text only for MVP — attachments / voice / groups deferred.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Contact {
  userId: string;
  username: string;
  name?: string;
  role: string;
}
interface Thread {
  threadId: string;
  otherUserId: string;
  otherUsername: string;
  otherName?: string;
  otherRole: string;
  lastMessageAt?: string;
  lastMessageText?: string;
  lastMessageFromMe?: boolean;
  unread: number;
}
interface Message {
  id: string;
  threadId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  createdAt: string;
  fromMe: boolean;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`/v2api${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/v2api${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.message || `POST ${path} ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export default function MessagesPage() {
  const { userId: activeUserIdRaw } = useParams<{ userId?: string }>();
  const activeUserId = activeUserIdRaw ?? "";
  const nav = useNavigate();

  const contactsQ = useQuery({
    queryKey: ["msg.contacts"],
    queryFn: () => get<{ contacts: Contact[] }>("/api/messages/contacts"),
    staleTime: 60_000,
  });
  const threadsQ = useQuery({
    queryKey: ["msg.threads"],
    queryFn: () => get<{ threads: Thread[]; totalUnread: number }>("/api/messages/threads"),
    refetchInterval: 8_000,
  });

  const contacts = contactsQ.data?.contacts ?? [];
  const threads = threadsQ.data?.threads ?? [];

  // Merge threads + contacts into a single sidebar. Threads first (with
  // unread + preview), then contacts without any prior message.
  const sidebar = useMemo(() => {
    const byUid = new Map<string, { threadId?: string; contact: Contact | null; thread?: Thread }>();
    for (const t of threads) {
      byUid.set(t.otherUserId, { threadId: t.threadId, contact: null, thread: t });
    }
    for (const c of contacts) {
      const existing = byUid.get(c.userId);
      if (existing) existing.contact = c;
      else byUid.set(c.userId, { contact: c });
    }
    return [...byUid.values()]
      .filter((e) => e.contact || e.thread)
      .sort((a, b) => {
        // Sort: threads with unread first, then by lastMessageAt desc, then contacts alphabetical.
        const au = a.thread?.unread ?? 0, bu = b.thread?.unread ?? 0;
        if (au !== bu) return bu - au;
        const at = a.thread?.lastMessageAt ? new Date(a.thread.lastMessageAt).getTime() : 0;
        const bt = b.thread?.lastMessageAt ? new Date(b.thread.lastMessageAt).getTime() : 0;
        if (at !== bt) return bt - at;
        const an = a.contact?.name || a.contact?.username || a.thread?.otherName || a.thread?.otherUsername || "";
        const bn = b.contact?.name || b.contact?.username || b.thread?.otherName || b.thread?.otherUsername || "";
        return an.localeCompare(bn);
      });
  }, [threads, contacts]);

  return (
    <div className="mx-auto max-w-6xl px-2 py-4 sm:px-4 sm:py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink-100 sm:text-3xl">💬 Messages</h1>
          <p className="text-xs text-ink-400">Direct messages with your academy — coaches, students, owner.</p>
        </div>
      </header>
      <div className="grid gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="max-h-[70vh] overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900/60">
          {contactsQ.isLoading || threadsQ.isLoading ? (
            <div className="p-6 text-center text-sm text-ink-400">Loading…</div>
          ) : sidebar.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-400">
              <div className="mb-2 text-3xl">💬</div>
              No contacts yet. Once you're in an academy you'll see people to message here.
            </div>
          ) : sidebar.map((row, i) => {
            const uid = row.contact?.userId ?? row.thread!.otherUserId;
            const displayName = row.contact?.name || row.contact?.username || row.thread?.otherName || row.thread?.otherUsername || uid;
            const role = row.contact?.role || row.thread?.otherRole || "user";
            const roleTag = role === "academy_owner" ? "Owner" : role === "coach" ? "Coach" : role === "student" ? "Student" : role;
            const isActive = uid === activeUserId;
            const unread = row.thread?.unread ?? 0;
            const preview = row.thread?.lastMessageText;
            return (
              <button
                key={i}
                onClick={() => nav(`/messages/${encodeURIComponent(uid)}`)}
                className={`flex w-full items-start gap-3 border-b border-ink-800 p-3 text-left transition ${isActive ? "bg-brand-500/15" : "hover:bg-ink-800/60"}`}
              >
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${role === "coach" ? "bg-amber-500/25 text-amber-100" : role === "academy_owner" ? "bg-purple-500/25 text-purple-100" : "bg-brand-500/20 text-brand-100"}`}>
                  {(displayName.match(/[A-Za-z0-9]/g) || []).slice(0, 2).join("").toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">{displayName}</div>
                    {unread > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                    <div className={`min-w-0 flex-1 truncate ${unread > 0 ? "font-medium text-ink-200" : "text-ink-500"}`}>
                      {row.thread?.lastMessageFromMe && <span className="text-ink-500">You: </span>}
                      {preview ?? <span className="italic text-ink-500">{roleTag}</span>}
                    </div>
                    <div className="shrink-0 text-[10px] text-ink-500">
                      {row.thread?.lastMessageAt ? fmtRel(row.thread.lastMessageAt) : ""}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Chat pane */}
        <section className="flex flex-col rounded-2xl border border-ink-700 bg-ink-900/60" style={{ minHeight: "60vh", maxHeight: "80vh" }}>
          {activeUserId ? (
            <ChatPane activeUserId={activeUserId} />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-ink-400">
              <div>
                <div className="mb-2 text-4xl">💬</div>
                <p>Pick a contact on the left to start chatting.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ChatPane({ activeUserId }: { activeUserId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Look up the contact for header + thread id derivation. We derive
  // threadId locally by sorted-pair so we don't need a separate "get
  // thread by user" round-trip.
  const contactsQ = useQuery({
    queryKey: ["msg.contacts"],
    queryFn: () => get<{ contacts: Contact[] }>("/api/messages/contacts"),
    staleTime: 60_000,
  });
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => get<any>("/auth/me") });
  const myId: string = meQ.data?.userId || "";
  const other = contactsQ.data?.contacts.find((c) => c.userId === activeUserId);

  const threadId = myId ? [myId, activeUserId].sort().join("::") : "";

  const messagesQ = useQuery({
    queryKey: ["msg.thread", threadId],
    queryFn: () => get<{ messages: Message[] }>(`/api/messages/threads/${encodeURIComponent(threadId)}`),
    enabled: !!threadId,
    refetchInterval: 8_000,
  });
  const messages = messagesQ.data?.messages ?? [];

  // Auto-scroll to bottom on new messages / thread switch.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, activeUserId]);

  // Mark this thread read whenever we open it or new incoming messages appear.
  useEffect(() => {
    if (!threadId) return;
    const hasIncoming = messages.some((m) => !m.fromMe);
    if (!hasIncoming) return;
    void post(`/api/messages/threads/${encodeURIComponent(threadId)}/read`, {}).then(() => {
      qc.invalidateQueries({ queryKey: ["msg.threads"] });
      qc.invalidateQueries({ queryKey: ["msg.unread-count"] });
    }).catch(() => { /* silent */ });
  }, [threadId, messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft("");
    try {
      await post("/api/messages/send", { toUserId: activeUserId, text });
      qc.invalidateQueries({ queryKey: ["msg.thread", threadId] });
      qc.invalidateQueries({ queryKey: ["msg.threads"] });
    } catch (e: any) {
      alert(e?.message || "Couldn't send.");
      setDraft(text);   // restore draft on failure
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-ink-800 p-3">
        <Link to="/messages" className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700 md:hidden">←</Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-white">{other?.name || other?.username || activeUserId}</div>
          <div className="text-[11px] text-ink-500">
            {other?.role === "coach" ? "Coach" : other?.role === "academy_owner" ? "Owner" : other?.role === "student" ? "Student" : "Contact"}
          </div>
        </div>
      </div>
      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messagesQ.isLoading ? (
          <div className="py-8 text-center text-sm text-ink-400">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-ink-400">
            <div>
              <div className="mb-2 text-3xl">👋</div>
              Say hi — no messages yet.
            </div>
          </div>
        ) : messages.map((m) => (
          <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.fromMe ? "rounded-tr-sm bg-brand-500 text-white" : "rounded-tl-sm bg-ink-800 text-ink-100"}`}>
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div className={`mt-0.5 text-[10px] ${m.fromMe ? "text-brand-100/70" : "text-ink-500"}`}>{fmtRel(m.createdAt)}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-ink-800 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="Type a message… (Enter to send · Shift+Enter for newline)"
          rows={1}
          maxLength={4000}
          className="min-h-10 max-h-32 flex-1 resize-none rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="inline-flex h-10 shrink-0 items-center rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 text-sm font-semibold text-white shadow-glow disabled:opacity-50"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </>
  );
}

function fmtRel(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const dif = Math.max(0, now - t);
  if (dif < 60_000) return "just now";
  if (dif < 3_600_000) return `${Math.floor(dif / 60_000)}m`;
  if (dif < 86_400_000) return `${Math.floor(dif / 3_600_000)}h`;
  const d = new Date(t);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yst = new Date(today); yst.setDate(today.getDate() - 1);
  const md = new Date(t); md.setHours(0, 0, 0, 0);
  if (md.getTime() === today.getTime()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (md.getTime() === yst.getTime())   return "yesterday";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
