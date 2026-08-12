// Server-side LiveKit integration — mints join tokens for classes and (later)
// talks to the RoomServiceClient for room management + Egress recording.
// Reads config from env at CALL time so a pm2 restart w/ new envs picks up
// without a code change: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.

import { Injectable, Logger } from "@nestjs/common";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const DEFAULT_TTL_MIN = 12 * 60;   // 12h token — covers a whole coaching day

@Injectable()
export class LivekitService {
  private readonly log = new Logger("Livekit");

  private cfg() {
    const url    = process.env.LIVEKIT_URL || "";
    const key    = process.env.LIVEKIT_API_KEY || "";
    const secret = process.env.LIVEKIT_API_SECRET || "";
    // The server SDK needs http(s) origin, not ws(s), so translate — but pass
    // the ws(s) URL back to the browser as-is (it uses signalling on ws).
    const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const configured = Boolean(url && key && secret);
    return { url, httpUrl, key, secret, configured };
  }

  isConfigured() { return this.cfg().configured; }
  clientUrl()    { return this.cfg().url; }

  /** Mint a join token for a participant. `identity` must be unique per room
   *  (LiveKit dedupes by it — same identity = same participant, replaces prior).
   *  Coaches get canPublishSources for camera/mic/screen; students may not
   *  screen-share (avoids kids spamming their desktop). */
  async createToken(opts: {
    roomName: string;
    identity: string;
    displayName: string;
    role: "coach" | "student";
    ttlMinutes?: number;
  }): Promise<{ token: string; url: string }> {
    const { key, secret, url, configured } = this.cfg();
    if (!configured) throw new Error("LiveKit not configured — set LIVEKIT_URL/KEY/SECRET");
    const at = new AccessToken(key, secret, {
      identity: opts.identity,
      name: opts.displayName,
      ttl: `${(opts.ttlMinutes ?? DEFAULT_TTL_MIN)}m`,
    });
    at.addGrant({
      room: opts.roomName,
      roomJoin: true,
      canPublish: true,        // camera + mic for everyone in P0
      canSubscribe: true,
      canPublishData: true,
      // Per-role screen-share restriction (students can't screen-share) uses
      // the TrackSource enum from livekit-server-sdk; lands in P1 alongside
      // coach controls (mute-all / kick / spotlight).
    });
    return { token: await at.toJwt(), url };
  }

  /** Kick a participant. Coach-only in controller. Idempotent — LiveKit
   *  returns 404 if the participant already left; we swallow it. */
  async removeParticipant(roomName: string, identity: string): Promise<void> {
    const { httpUrl, key, secret, configured } = this.cfg();
    if (!configured) throw new Error("LiveKit not configured");
    const svc = new RoomServiceClient(httpUrl, key, secret);
    try {
      await svc.removeParticipant(roomName, identity);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!/not found|does not exist/i.test(msg)) throw err;
      this.log.warn(`removeParticipant ${roomName}/${identity}: already gone`);
    }
  }

  /** Best-effort create-or-fetch of a room. LiveKit lazy-creates on first join
   *  too, but calling this lets us set metadata (owning academy, class title). */
  async ensureRoom(roomName: string, metadata?: Record<string, unknown>) {
    const { httpUrl, key, secret, configured } = this.cfg();
    if (!configured) return;
    try {
      const svc = new RoomServiceClient(httpUrl, key, secret);
      await svc.createRoom({
        name: roomName,
        emptyTimeout: 60 * 15,        // 15m before an empty room is torn down
        maxParticipants: 100,          // safety cap; academy-tier can raise later
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      });
    } catch (err: any) {
      // "already exists" is expected — swallow it, log everything else
      const msg = String(err?.message || err);
      if (!/already exists/i.test(msg)) this.log.warn(`ensureRoom ${roomName}: ${msg}`);
    }
  }
}
