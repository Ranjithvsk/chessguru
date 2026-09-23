// A presigned S3 GET URL, signed by hand.
//
// Used to serve class recordings that now live in Backblaze B2 rather than on
// this disk. Hand-rolled rather than pulling in @aws-sdk/client-s3 plus the
// presigner for one URL: SigV4 query signing is a fixed, well-specified
// recipe, and node's crypto already has everything it needs.
//
// A redirect to a presigned URL — rather than streaming the file through this
// server — matters more than it looks for video: the browser gets to make its
// own range requests straight to B2 while scrubbing, which is exactly what the
// replay player does against currentTime. Proxying would put every seek through
// France and hold a socket open for the length of the lesson.

import { createHash, createHmac } from "crypto";
import { readFileSync } from "fs";

export type S3Config = {
  endpoint: string;      // https://s3.us-east-005.backblazeb2.com
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Read once, then cache — but never cache a FAILURE, so fixing the file does
 *  not need an API restart. */
let cached: S3Config | null = null;
export function s3Config(path = process.env.B2_RECORDINGS_CONFIG || "/etc/chessguru/b2-recordings.json"): S3Config | null {
  if (cached) return cached;
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    if (!c?.endpoint || !c?.bucket || !c?.accessKeyId || !c?.secretAccessKey) return null;
    cached = c as S3Config;
    return cached;
  } catch { return null; }
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
/** Object keys keep their slashes — encoding them breaks the path. */
const encKey = (k: string) => k.split("/").map(enc).join("/");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();
const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** A presigned GET, valid for `expiresSec`. */
export function presignGet(cfg: S3Config, key: string, expiresSec = 3600): string {
  const url = new URL(cfg.endpoint);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20260923T051500Z
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  // Path-style (/bucket/key), which B2's S3 endpoint accepts and which avoids
  // needing a bucket-name-as-subdomain certificate.
  const canonicalUri = `/${enc(cfg.bucket)}/${encKey(key)}`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.min(Math.max(expiresSec, 1), 604800))],
    ["X-Amz-SignedHeaders", "host"],
  ];
  // SigV4 requires the query string sorted by encoded key.
  const canonicalQuery = params
    .map(([k, v]) => [enc(k), enc(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "GET", canonicalUri, canonicalQuery,
    `host:${host}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
