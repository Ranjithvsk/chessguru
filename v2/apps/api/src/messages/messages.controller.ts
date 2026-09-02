// Direct 1:1 messages between academy members (2026-09-02).
//
// Two collections:
//   * messages       — one doc per message: {threadId, from, to, text, createdAt}
//   * messageThreads — one doc per (sorted-pair) conversation: {participants,
//                      lastMessageAt, lastMessageText, unread: {uid: n}}
//
// Access rules (owner directive):
//   * Coach ↔ any student they coach, any other coach in academy, the owner
//   * Student ↔ their assigned coach, the owner
//   * Owner ↔ every coach + every student in their academy
// (Parent messaging deferred — layer on top later.)
//
// Frontend polls /api/messages/threads every 8s to get fresh unread counts
// and previews. When a thread is open, /api/messages/threads/:tid returns
// the message list (also poll-refreshed). Sending marks read for sender.

import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";
import { PushService } from "../push/push.service";

// Compose a stable threadId from two userIds. Sorted so (A,B) and (B,A)
// map to the SAME thread regardless of who sent first.
function threadIdOf(u1: string, u2: string): string {
  const [a, b] = [u1, u2].sort();
  return `${a}::${b}`;
}

interface ContactRow {
  userId: string;
  username: string;
  name?: string;
  role: string;   // "coach" | "student" | "academy_owner" | "parent"
  online?: boolean;
}
interface ThreadRow {
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
interface MessageRow {
  id: string;
  threadId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  createdAt: string;
  fromMe: boolean;
}

@Controller("messages")
export class MessagesController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly push: PushService,
  ) {}

  private msgs()    { return this.conn.db!.collection("messages"); }
  private threads() { return this.conn.db!.collection("messageThreads"); }
  private users()   { return this.conn.db!.collection("users"); }

  /** Users the caller is ALLOWED to message. Access rules above.
   *  Returns dedup'd list, sorted role then name. */
  @Get("contacts")
  async listContacts(@Req() req: any): Promise<{ contacts: ContactRow[] }> {
    const me = await this.requireMe(req);
    const academyId = me.academyId;
    if (!academyId) return { contacts: [] };
    let filter: any = {};
    if (me.role === "academy_owner") {
      filter = { academyId, role: { $in: ["coach", "student", "academy_owner"] } };
    } else if (me.role === "coach") {
      // Every coach in academy + every student they coach + owner
      filter = {
        academyId,
        $or: [
          { role: { $in: ["coach", "academy_owner"] } },
          { role: "student", coachId: me.userId },
        ],
      };
    } else if (me.role === "student") {
      // Their coach + owner
      filter = {
        academyId,
        $or: [
          { role: "academy_owner" },
          ...(me.coachId ? [{ _id: me.coachId as any }] : []),
        ],
      };
    } else {
      return { contacts: [] };
    }
    const rows: any[] = await this.users().find(filter, { projection: { _id: 1, username: 1, name: 1, role: 1 } }).limit(500).toArray();
    const contacts: ContactRow[] = rows
      .filter((u) => String(u._id) !== me.userId)
      .map((u) => ({ userId: String(u._id), username: u.username, name: u.name, role: u.role }));
    // Sort: owner first, coaches next, students last; then by name.
    const rank = (r: string) => r === "academy_owner" ? 0 : r === "coach" ? 1 : 2;
    contacts.sort((a, b) => (rank(a.role) - rank(b.role)) || String(a.name || a.username).localeCompare(String(b.name || b.username)));
    return { contacts };
  }

  /** Threads where the caller participates. */
  @Get("threads")
  async listThreads(@Req() req: any): Promise<{ threads: ThreadRow[]; totalUnread: number }> {
    const me = await this.requireMe(req);
    const rows: any[] = await this.threads()
      .find({ participants: me.userId })
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .toArray();
    if (rows.length === 0) return { threads: [], totalUnread: 0 };
    const otherIds = rows.map((r) => (r.participants as string[]).find((p) => p !== me.userId)).filter((v): v is string => !!v);
    const users: any[] = await this.users().find({ _id: { $in: otherIds as any[] } }, { projection: { _id: 1, username: 1, name: 1, role: 1 } }).toArray();
    const uById = new Map(users.map((u) => [String(u._id), u]));
    let totalUnread = 0;
    const threads: ThreadRow[] = rows.map((r) => {
      const other = (r.participants as string[]).find((p) => p !== me.userId) || "";
      const u = uById.get(other);
      const unread = Number(r?.unread?.[me.userId] ?? 0);
      totalUnread += unread;
      return {
        threadId: r._id,
        otherUserId: other,
        otherUsername: u?.username || other,
        otherName: u?.name,
        otherRole: u?.role || "user",
        lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : undefined,
        lastMessageText: r.lastMessageText,
        lastMessageFromMe: r.lastMessageFromUserId === me.userId,
        unread,
      };
    });
    return { threads, totalUnread };
  }

  /** Message list in a thread. Sorted oldest→newest for chat rendering. */
  @Get("threads/:threadId")
  async listMessages(@Req() req: any, @Param("threadId") threadId: string): Promise<{ messages: MessageRow[] }> {
    const me = await this.requireMe(req);
    // Auth: caller must be one of the participants.
    const t: any = await this.threads().findOne({ _id: threadId as any, participants: me.userId });
    if (!t) throw new ForbiddenException();
    const rows: any[] = await this.msgs()
      .find({ threadId })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray();
    const messages: MessageRow[] = rows.map((r) => ({
      id: String(r._id),
      threadId: r.threadId,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      text: String(r.text ?? ""),
      createdAt: new Date(r.createdAt).toISOString(),
      fromMe: r.fromUserId === me.userId,
    }));
    return { messages };
  }

  /** Post a message. Body: {toUserId, text}. Creates thread on first message. */
  @Post("send")
  async send(@Req() req: any, @Body() body: any): Promise<{ ok: true; threadId: string; messageId: string }> {
    const me = await this.requireMe(req);
    const toUserId = typeof body?.toUserId === "string" ? body.toUserId : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!toUserId) throw new BadRequestException("toUserId is required.");
    if (!text) throw new BadRequestException("Message text is required.");
    if (text.length > 4000) throw new BadRequestException("Message too long (4000 chars max).");
    if (toUserId === me.userId) throw new BadRequestException("Can't message yourself.");

    // Auth: must be allowed per contact rules. Cheap way: verify the target
    // user is in the caller's contact list.
    const allowed = await this.canMessage(me, toUserId);
    if (!allowed) throw new ForbiddenException("You can't message that user.");

    const threadId = threadIdOf(me.userId, toUserId);
    const now = new Date();
    const preview = text.length > 120 ? text.slice(0, 117) + "…" : text;

    // Insert the message.
    const ins = await this.msgs().insertOne({
      threadId,
      fromUserId: me.userId,
      toUserId,
      text,
      createdAt: now,
    });

    // Upsert the thread. Increment unread count for the recipient only.
    await this.threads().updateOne(
      { _id: threadId as any },
      {
        $set: {
          academyId: me.academyId ?? null,
          participants: [me.userId, toUserId].sort(),
          lastMessageAt: now,
          lastMessageText: preview,
          lastMessageFromUserId: me.userId,
        },
        $inc: { [`unread.${toUserId}`]: 1 },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    // Push notification to the recipient — fire-and-forget so a slow vendor
    // never blocks the send() response. sendToUser() is a no-op when the
    // recipient has no subscriptions (opted out, no device with push enabled,
    // or VAPID keys not configured in dev). Title is the sender's display
    // name; body is the preview text (already truncated to 120c). Clicking
    // the notification deep-links to /messages?open=<threadId> so the
    // recipient lands directly in the conversation.
    //
    // We look up the sender's display name inline — cheap point-read on the
    // users collection. The recipient sees who messaged them, not just a
    // generic "ChessGuru — new message" banner.
    void (async () => {
      try {
        const sender: any = await this.users().findOne(
          { _id: me.userId as any },
          { projection: { name: 1, fullName: 1, username: 1 } },
        );
        const senderName = String(sender?.name || sender?.fullName || sender?.username || "New message");
        await this.push.sendToUser(toUserId, {
          title: senderName,
          body: preview,
          // /messages/<senderId> — the recipient's route to the conversation
          // with the person who just messaged them. Matches Messages.tsx's
          // useParams<{userId?}>() so the thread opens directly.
          url: `/messages/${encodeURIComponent(me.userId)}`,
          // Tag by thread so subsequent messages in the same conversation
          // collapse the previous notification instead of stacking N banners.
          tag: `msg:${threadId}`,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[messages] push send failed", { threadId, err: (e as Error)?.message });
      }
    })();

    return { ok: true, threadId, messageId: String(ins.insertedId) };
  }

  /** Mark a thread as read for the caller. */
  @Post("threads/:threadId/read")
  async markRead(@Req() req: any, @Param("threadId") threadId: string): Promise<{ ok: true }> {
    const me = await this.requireMe(req);
    await this.threads().updateOne(
      { _id: threadId as any, participants: me.userId },
      { $set: { [`unread.${me.userId}`]: 0 } },
    );
    return { ok: true };
  }

  /** Total unread across all threads (for navbar badge). */
  @Get("unread-count")
  async unreadCount(@Req() req: any): Promise<{ count: number }> {
    const me = await this.requireMe(req);
    const rows: any[] = await this.threads()
      .find({ participants: me.userId }, { projection: { unread: 1 } as never })
      .toArray();
    let n = 0;
    for (const r of rows) n += Number(r?.unread?.[me.userId] ?? 0);
    return { count: n };
  }

  // ---- helpers ----------------------------------------------------------
  private async requireMe(req: any): Promise<{ userId: string; role: string; academyId?: string; coachId?: string }> {
    const userId: string | undefined = req?.session?.userId;
    if (!userId) throw new UnauthorizedException();
    const u: any = await this.users().findOne({ _id: userId as any }, { projection: { role: 1, academyId: 1, coachId: 1 } });
    if (!u) throw new UnauthorizedException();
    return { userId, role: String(u.role || ""), academyId: u.academyId || undefined, coachId: u.coachId || undefined };
  }

  private async canMessage(me: { userId: string; role: string; academyId?: string; coachId?: string }, toUserId: string): Promise<boolean> {
    if (!me.academyId) return false;
    const other: any = await this.users().findOne({ _id: toUserId as any }, { projection: { role: 1, academyId: 1, coachId: 1 } });
    if (!other) return false;
    if (other.academyId !== me.academyId) return false;   // no cross-academy
    if (me.role === "academy_owner") return ["coach", "student", "academy_owner"].includes(other.role);
    if (me.role === "coach") {
      if (["coach", "academy_owner"].includes(other.role)) return true;
      if (other.role === "student" && other.coachId === me.userId) return true;
      return false;
    }
    if (me.role === "student") {
      if (other.role === "academy_owner") return true;
      if (other.role === "coach" && me.coachId === toUserId) return true;
      return false;
    }
    return false;
  }
}
