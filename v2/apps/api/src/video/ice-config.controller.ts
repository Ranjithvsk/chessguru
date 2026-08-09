// GET /api/video/ice-config — hands the browser its RTCPeerConnection iceServers
// list. STUN is public Google (always safe); TURN creds are minted per-request
// using the coturn REST-API auth scheme (username = "<expiryUnix>:<userId>",
// password = base64(HMAC-SHA1(secret, username))). 1h TTL so a stolen ice-config
// can't be used to freeload TURN bandwidth forever.
//
// Requires session (only signed-in ChessGuru users get TURN — guests get STUN
// only, which handles ~90% of NAT scenarios anyway).

import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "crypto";

const TURN_HOST = () => process.env.TURN_HOST || "meet.harinitharanjith.com";
const TURN_SECRET = () => process.env.TURN_SHARED_SECRET || "";
const TURN_TTL_SEC = 60 * 60;   // 1h

@Controller("video")
export class IceConfigController {
  @Get("ice-config")
  iceConfig(@Req() req: any) {
    const uid: string | null = req?.session?.userId ?? null;
    if (!uid) throw new UnauthorizedException("sign in first");

    // Always include public STUN — free, always works, first-choice for direct P2P.
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ];

    const secret = TURN_SECRET();
    if (secret) {
      const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SEC;
      const username = `${expiry}:${uid}`;
      const credential = createHmac("sha1", secret).update(username).digest("base64");
      const host = TURN_HOST();
      // Give both UDP and TLS variants; browsers pick the first that works.
      // TURN-over-TLS on 5349 punches through corporate firewalls that block UDP.
      iceServers.push(
        { urls: [`turn:${host}:3478?transport=udp`, `turns:${host}:5349?transport=tcp`], username, credential },
      );
    }

    return { iceServers, ttlSec: TURN_TTL_SEC, turnConfigured: !!secret };
  }
}
