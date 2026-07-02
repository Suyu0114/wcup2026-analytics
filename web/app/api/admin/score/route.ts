import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/adminAuth';
import { writeManualResult, triggerRecompute } from '@/lib/adminServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_GOALS = 30;

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    matchId?: unknown;
    homeGoals?: unknown;
    awayGoals?: unknown;
    overrideFd?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const matchId = typeof body.matchId === 'string' ? body.matchId : '';
  const homeGoals = body.homeGoals;
  const awayGoals = body.awayGoals;
  const overrideFd = body.overrideFd === true;
  const validGoal = (g: unknown): g is number =>
    typeof g === 'number' && Number.isInteger(g) && g >= 0 && g <= MAX_GOALS;

  if (!matchId || !validGoal(homeGoals) || !validGoal(awayGoals)) {
    return NextResponse.json(
      { error: `matchId and integer goals (0–${MAX_GOALS}) are required` },
      { status: 400 },
    );
  }

  try {
    await writeManualResult(matchId, homeGoals, awayGoals, overrideFd);
  } catch (err) {
    // Don't swallow the DB reason — the route is admin-only (isAuthed above), so
    // surfacing the Postgrest message to the caller + server log is safe and turns
    // an opaque 500 into an actionable one (RLS denial / FK violation / bad key).
    console.error('[admin/score] writeManualResult failed:', err);
    const e = err as { message?: string; code?: string; hint?: string };
    return NextResponse.json(
      { error: 'Failed to save score', detail: e?.message ?? String(err), code: e?.code },
      { status: 500 },
    );
  }

  const recompute = await triggerRecompute();
  return NextResponse.json({ ok: true, recompute });
}
