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
    role: "coach" | "student" | "observer";
    ttlMinutes?: number;
  }): Promise<{ token: string; url: string }> {
    const { key, secret, url, configured } = this.cfg();
    if (!configured) throw new Error("LiveKit not configured — set LIVEKIT_URL/KEY/SECRET");
    const at = new AccessToken(key, secret, {
      identity: opts.identity,
      name: opts.displayName,
      ttl: `${(opts.ttlMinutes ?? DEFAULT_TTL_MIN)}m`,
    });
    // A silent observer: sees and hears the class, contributes nothing to it, and
    // is not in the participant list the other clients render. `hidden` is the
    // SFU's own flag — without it the watcher shows up as a face in the call even
    // with publishing off, which is exactly what must not happen.
    const observing = opts.role === "observer";
    at.addGrant({
      room: opts.roomName,
      roomJoin: true,
      canPublish: !observing,  // camera + mic for everyone in P0
      canSubscribe: true,
      canPublishData: !observing,
      hidden: observing,
      // Per-role screen-share restriction (students can't screen-share) uses
      // the TrackSource enum from livekit-server-sdk; lands in P1 alongside
      // coach controls (mute-all / kick / spotlight).
    });
    return { token: await at.toJwt(), url };
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

  /** What the SFU actually believes about one participant's microphone.
   *
   *  The client cannot see this, and the two genuinely drift apart: a failed
   *  mic re-acquire can leave the track muted here while the publisher's own
   *  UI reports it live, so the coach talks to a room that hears silence and
   *  every local signal tells them it is fine. A student refreshing does not
   *  help, because nothing is being published to subscribe to.
   *  (owner, 2026-09-21)
   *
   *  Returns null when we cannot tell — caller must treat that as "no opinion"
   *  and never as "muted", or it would round-trip a healthy mic for nothing. */
  async micState(roomName: string, identity: string): Promise<{ muted: boolean; trackSid: string } | null> {
    const { httpUrl, key, secret, configured } = this.cfg();
    if (!configured) return null;
    try {
      const svc = new RoomServiceClient(httpUrl, key, secret);
      const ps = await svc.listParticipants(roomName);
      const me = ps.find((p) => p.identity === identity);
      if (!me) return null;
      // TrackSource.MICROPHONE === 2
      const mic = me.tracks.find((t) => t.source === 2) ?? me.tracks.find((t) => t.type === 0);
      if (!mic) return null;
      return { muted: !!mic.muted, trackSid: mic.sid };
    } catch (err: any) {
      this.log.warn(`micState ${roomName}/${identity}: ${String(err?.message || err)}`);
      return null;
    }
  }
}
