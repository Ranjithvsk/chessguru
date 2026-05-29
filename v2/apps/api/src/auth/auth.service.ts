import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import bcrypt from "bcryptjs";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

@Injectable()
export class AuthService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private users() { return this.conn.db!.collection("users"); }

  async register(body: any, session: any) {
    const { username, password, email } = body ?? {};
    if (!username || !password) return { ok: false, error: "Username and password required." };
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(username)) return { ok: false, error: "Invalid username format." };
    if (String(password).length < 6) return { ok: false, error: "Password too short (min 6 chars)." };
    const col = this.users();
    const existing = await col.findOne({ username: { $regex: new RegExp("^" + esc(username) + "$", "i") } });
    if (existing) return { ok: false, error: "Username already taken." };
    const hash = await bcrypt.hash(password, 10);
    const doc = { _id: username.toLowerCase(), username, bpass: hash, email: email || null, createdAt: new Date() };
    await col.insertOne(doc as any);
    session.userId = doc._id;
    session.username = username;
    return { ok: true };
  }

  async signin(body: any, session: any) {
    const { username, password, keep } = body ?? {};
    if (!username || !password) return { ok: false, error: "Please fill in all fields." };
    const col = this.users();
    const user: any = await col.findOne({
      $or: [
        { username: { $regex: new RegExp("^" + esc(username) + "$", "i") } },
        { email: String(username).toLowerCase() },
      ],
    });
    if (!user) return { ok: false, error: "Invalid username or password." };
    let hash: any = user.bpass;
    if (hash && typeof hash === "object") {
      if (hash.buffer) hash = Buffer.from(hash.buffer).toString("utf8");
      else if (Buffer.isBuffer(hash)) hash = hash.toString("utf8");
      else hash = String(hash);
    }
    if (!hash || typeof hash !== "string") return { ok: false, error: "Invalid username or password." };
    const ok = await bcrypt.compare(password, hash);
    if (!ok) return { ok: false, error: "Invalid username or password." };
    session.userId = user._id;
    session.username = user.username;
    if (keep && session.cookie) session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    return { ok: true };
  }

  me(session: any) {
    if (!session?.userId) return { loggedIn: false };
    return { loggedIn: true, username: session.username, userId: session.userId };
  }

  logout(session: any): Promise<{ ok: boolean }> {
    return new Promise((resolve) => session.destroy(() => resolve({ ok: true })));
  }

  async myRating(session: any) {
    if (!session?.userId) return { rating: 1500, loggedIn: false };
    const doc: any = await this.conn.db!.collection("userperfs").findOne({ _id: session.userId });
    return { rating: Math.round(doc?.puzzle?.gl?.r ?? 1500), loggedIn: true, userId: session.userId };
  }
}
