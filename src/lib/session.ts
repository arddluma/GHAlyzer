import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";

/**
 * Encrypted, tamper-proof session cookie.
 *
 * Format: <iv>.<authTag>.<ciphertext>  (all base64url)
 * Cipher: AES-256-GCM
 * Key:    SESSION_SECRET (base64-encoded 32 bytes)
 *
 * Payload contains an `exp` field checked on decode; expired cookies are
 * rejected.
 */

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

export type Session = {
  login: string;
  id: number;
  avatar_url: string;
  userToken: string; // GitHub App user-to-server OAuth token
  userTokenExp?: number; // unix seconds (optional, some OAuth Apps don't expire)
  exp: number; // session cookie expiry (unix seconds)
};

function getKey(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  const buf = Buffer.from(s, "base64");
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `SESSION_SECRET must decode to ${KEY_LEN} bytes (got ${buf.length}). Generate with: openssl rand -base64 32`
    );
  }
  return buf;
}

export function sealSession(
  data: Omit<Session, "exp">,
  ttlSec = 8 * 60 * 60
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = JSON.stringify({ ...data, exp });
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function openSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ct = Buffer.from(parts[2], "base64url");
    if (iv.length !== IV_LEN) return null;
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const obj = JSON.parse(pt) as Session;
    if (typeof obj.exp !== "number") return null;
    if (obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "ghalyzer_session";
export const OAUTH_STATE_COOKIE = "ghalyzer_oauth_state";

export function sessionCookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60, // 8 hours
  };
}

export function stateCookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // 10 minutes
  };
}

/** Constant-time string compare for OAuth state. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
