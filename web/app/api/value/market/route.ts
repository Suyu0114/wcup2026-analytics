import { NextResponse } from 'next/server';
import { getValueMarket } from '@/lib/data';

// Market side for the EV calculator (P5 §4.3). Returns de-vig prob + best line + model layer
// + freshness. The user-odds arithmetic stays client-side (lib/value.ts). Always dynamic.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get('match_id');
  const market = searchParams.get('market');
  const outcome = searchParams.get('outcome');
  const modelVersion = searchParams.get('v') ?? undefined; // P10: model side follows the switcher

  if (!matchId || (market !== 'h2h' && market !== 'totals') || !outcome) {
    return NextResponse.json(
      { error: 'match_id, market (h2h|totals) and outcome are required' },
      { status: 400 },
    );
  }

  const data = await getValueMarket(matchId, market, outcome, modelVersion);
  return NextResponse.json(data, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
