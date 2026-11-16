import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

/** 256 bits of randomness, URL-safe. Shown to the holder once, never stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What the database stores in place of a token. Keyed with the server secret,
 * so a leaked table cannot be replayed and cannot be brute-forced offline.
 */
export function hashToken(token: string): string {
  return createHmac("sha256", env().SESSION_SECRET).update(token).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
