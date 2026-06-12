import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  checkPassword,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body?.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S;
  const token = signSession(exp);
  if (!token) {
    return NextResponse.json({ error: 'Server auth not configured' }, { status: 500 });
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return NextResponse.json({ ok: true });
}
