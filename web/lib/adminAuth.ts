import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';

// Single shared-password admin auth (P7). Stateless HMAC-signed cookie — no session
// store. Secrets are server-only env vars; never prefix with NEXT_PUBLIC_.
//   ADMIN_PASSWORD_HASH   = sha256(password) hex
//   ADMIN_SESSION_SECRET  = random 32+ byte string used to HMAC the session token

export const SESSION_COOKIE = 'admin_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** True iff `password` matches ADMIN_PASSWORD_HASH (constant-time). */
export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD_HASH;
  if (!expected) return false;
  return constantTimeEqualHex(sha256Hex(password), expected);
}

/** Signed session token `"<exp>.<hmac>"`, or null if the secret is unconfigured. */
export function signSession(expEpochSeconds: number): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const payload = String(expEpochSeconds);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** Verify token signature AND expiry. */
export function verifyToken(token: string | undefined): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!token || !secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!constantTimeEqualHex(sig, expected)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
}

/** Read + verify the session cookie (use in server components / route handlers). */
export async function isAuthed(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}
