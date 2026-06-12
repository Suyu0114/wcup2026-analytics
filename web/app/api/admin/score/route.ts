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

  let body: { matchId?: unknown; homeGoals?: unknown; awayGoals?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const matchId = typeof body.matchId === 'string' ? body.matchId : '';
  const homeGoals = body.homeGoals;
  const awayGoals = body.awayGoals;
  const validGoal = (g: unknown): g is number =>
    typeof g === 'number' && Number.isInteger(g) && g >= 0 && g <= MAX_GOALS;

  if (!matchId || !validGoal(homeGoals) || !validGoal(awayGoals)) {
    return NextResponse.json(
      { error: `matchId and integer goals (0–${MAX_GOALS}) are required` },
      { status: 400 },
    );
  }

  try {
    await writeManualResult(matchId, homeGoals, awayGoals);
  } catch {
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 });
  }

  const recompute = await triggerRecompute();
  return NextResponse.json({ ok: true, recompute });
}
