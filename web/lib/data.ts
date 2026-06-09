import 'server-only';
import { getSupabase } from './supabaseServer';
import { novig } from './devig';
import { computeUpset } from './upset';
import { isQuarterLine } from './value';
import { MODEL_VERSION, PINNACLE, FRESH_WINDOW_MS } from './constants';
import type {
  MatchesResponse,
  MatchView,
  MatchMarket,
  GroupsResponse,
  GroupTeam,
  ValueMarketResponse,
  BookPrice,
  Freshness,
  FreshnessSummary,
} from './types';

interface OddsRow {
  match_id: string;
  bookmaker: string;
  market: string;
  outcome: string;
  point: number | null;
  decimal_odds: number;
  captured_at: string;
  last_update: string | null;
}

const seriesKey = (r: { match_id: string; bookmaker: string; market: string; outcome: string; point: number | null }) =>
  `${r.match_id}|${r.bookmaker}|${r.market}|${r.outcome}|${r.point ?? -1}`;

/** Latest snapshot per (match,book,market,outcome,point) — Issue 1: scan by match_id and reduce
 * in memory (PostgREST has no DISTINCT ON), ordered captured_at asc so last seen = latest. */
async function fetchLatestOdds(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  matchIds: string[],
): Promise<OddsRow[]> {
  const page = 1000;
  let start = 0;
  const latest = new Map<string, OddsRow>();
  for (;;) {
    const { data, error } = await client
      .from('odds_snapshots')
      .select('match_id,bookmaker,market,outcome,point,decimal_odds,captured_at,last_update')
      .in('match_id', matchIds)
      .order('captured_at', { ascending: true })
      .range(start, start + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as OddsRow[];
    for (const r of rows) latest.set(seriesKey(r), { ...r, decimal_odds: Number(r.decimal_odds), point: r.point === null ? null : Number(r.point) });
    if (rows.length < page) break;
    start += page;
  }
  return [...latest.values()];
}

function freshnessOf(rows: OddsRow[]): Freshness | null {
  if (rows.length === 0) return null;
  let captured: string | null = null;
  let lastUpdate: string | null = null;
  for (const r of rows) {
    if (captured === null || r.captured_at > captured) captured = r.captured_at;
    if (r.last_update && (lastUpdate === null || r.last_update > lastUpdate)) lastUpdate = r.last_update;
  }
  const stale = captured !== null && Date.now() - new Date(captured).getTime() > FRESH_WINDOW_MS;
  return { captured_at: captured, last_update: lastUpdate, stale };
}

/** Pinnacle totals main line (P3 §2): if multiple points, the one whose two-sided implied
 * probabilities are closest (min |1/over − 1/under|). Requires both over & under. */
function pinnacleMainPoint(rows: OddsRow[]): number | null {
  const byPoint = new Map<number, { over?: number; under?: number }>();
  for (const r of rows) {
    if (r.bookmaker !== PINNACLE || r.market !== 'totals' || r.point === null) continue;
    const slot = byPoint.get(r.point) ?? {};
    if (r.outcome === 'over') slot.over = r.decimal_odds;
    if (r.outcome === 'under') slot.under = r.decimal_odds;
    byPoint.set(r.point, slot);
  }
  let best: number | null = null;
  let bestGap = Infinity;
  for (const [point, { over, under }] of byPoint) {
    if (over === undefined || under === undefined) continue;
    const gap = Math.abs(1 / over - 1 / under);
    if (gap < bestGap) {
      bestGap = gap;
      best = point;
    }
  }
  return best;
}

function buildMatchMarket(rows: OddsRow[]): MatchMarket | null {
  if (rows.length === 0) return null;
  // pinnacle h2h de-vig
  const pinH2H: Record<string, number> = {};
  for (const r of rows) {
    if (r.bookmaker === PINNACLE && r.market === 'h2h') pinH2H[r.outcome] = r.decimal_odds;
  }
  const haveAllThree = ['home', 'draw', 'away'].every((o) => pinH2H[o] !== undefined);
  const pinnacleNovig = haveAllThree
    ? (() => {
        const p = novig({ home: pinH2H.home, draw: pinH2H.draw, away: pinH2H.away });
        return { home: p.home, draw: p.draw, away: p.away };
      })()
    : null;

  // best h2h per outcome across books
  const best: Record<string, BookPrice | null> = { home: null, draw: null, away: null };
  for (const r of rows) {
    if (r.market !== 'h2h' || !(r.outcome in best)) continue;
    const cur = best[r.outcome];
    if (cur === null || r.decimal_odds > cur.decimal) best[r.outcome] = { book: r.bookmaker, decimal: r.decimal_odds };
  }

  return {
    pinnacle_novig: pinnacleNovig,
    best_h2h: { home: best.home, draw: best.draw, away: best.away },
    freshness: freshnessOf(rows.filter((r) => r.bookmaker === PINNACLE)),
  };
}

export async function getMatches(): Promise<MatchesResponse> {
  const client = getSupabase();
  if (!client) return { matches: [], unavailable: true };
  try {
    const [{ data: teams, error: te }, { data: matches, error: me }, { data: preds, error: pe }] =
      await Promise.all([
        client.from('teams').select('team_id,name_en,name_zh,elo'),
        client
          .from('matches')
          .select('match_id,stage,group_label,home_team,away_team,kickoff_utc,status')
          .eq('stage', 'group'),
        client
          .from('match_predictions')
          .select('match_id,p_home,p_draw,p_away,p_over_2_5,p_btts,exp_total_goals')
          .eq('model_version', MODEL_VERSION),
      ]);
    if (te || me || pe) throw te || me || pe;

    const teamMap = new Map((teams ?? []).map((t) => [t.team_id, t]));
    const predMap = new Map((preds ?? []).map((p) => [p.match_id, p]));

    // odds are optional — failure here must not hide predictions (graceful, §6.6)
    let oddsByMatch = new Map<string, OddsRow[]>();
    const matchIds = (matches ?? []).map((m) => m.match_id);
    try {
      if (matchIds.length > 0) {
        const oddsRows = await fetchLatestOdds(client, matchIds);
        oddsByMatch = oddsRows.reduce((acc, r) => {
          (acc.get(r.match_id) ?? acc.set(r.match_id, []).get(r.match_id)!).push(r);
          return acc;
        }, new Map<string, OddsRow[]>());
      }
    } catch {
      oddsByMatch = new Map();
    }

    const views: MatchView[] = [];
    for (const m of matches ?? []) {
      const home = teamMap.get(m.home_team);
      const away = teamMap.get(m.away_team);
      if (!home || !away) continue; // contract violation skipped defensively
      const pred = predMap.get(m.match_id);
      const model = pred
        ? {
            model_version: MODEL_VERSION,
            p_home: Number(pred.p_home),
            p_draw: Number(pred.p_draw),
            p_away: Number(pred.p_away),
            p_over_2_5: Number(pred.p_over_2_5),
            p_btts: pred.p_btts === null ? null : Number(pred.p_btts),
            exp_total_goals: Number(pred.exp_total_goals),
            upset: computeUpset({
              homeTeam: m.home_team,
              awayTeam: m.away_team,
              eloHome: Number(home.elo),
              eloAway: Number(away.elo),
              pHome: Number(pred.p_home),
              pDraw: Number(pred.p_draw),
              pAway: Number(pred.p_away),
            }),
          }
        : null;
      views.push({
        match_id: m.match_id,
        stage: m.stage,
        group_label: m.group_label,
        kickoff_utc: m.kickoff_utc,
        status: m.status,
        home: { team_id: home.team_id, name_en: home.name_en, name_zh: home.name_zh, elo: Number(home.elo) },
        away: { team_id: away.team_id, name_en: away.name_en, name_zh: away.name_zh, elo: Number(away.elo) },
        model,
        market: buildMatchMarket(oddsByMatch.get(m.match_id) ?? []),
      });
    }
    views.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    return { matches: views, unavailable: false };
  } catch {
    return { matches: [], unavailable: true };
  }
}

export async function getGroups(): Promise<GroupsResponse> {
  const empty: GroupsResponse = {
    model_version: null,
    sim_n: null,
    computed_at: null,
    groups: {},
    unavailable: true,
  };
  const client = getSupabase();
  if (!client) return empty;
  try {
    const [{ data: sim, error: se }, { data: teams, error: te }] = await Promise.all([
      client
        .from('group_sim')
        .select('team_id,group_label,p_first,p_second,p_third_qual,p_advance,sim_n,model_version,computed_at')
        .eq('model_version', MODEL_VERSION),
      client.from('teams').select('team_id,name_en,name_zh'),
    ]);
    if (se || te) throw se || te;
    const teamMap = new Map((teams ?? []).map((t) => [t.team_id, t]));
    const groups: Record<string, GroupTeam[]> = {};
    let simN: number | null = null;
    let computedAt: string | null = null;
    for (const r of sim ?? []) {
      simN = Number(r.sim_n);
      computedAt = r.computed_at;
      const t = teamMap.get(r.team_id);
      (groups[r.group_label] ??= []).push({
        team_id: r.team_id,
        name_en: t?.name_en ?? r.team_id,
        name_zh: t?.name_zh ?? null,
        p_first: Number(r.p_first),
        p_second: Number(r.p_second),
        p_third_qual: Number(r.p_third_qual),
        p_advance: Number(r.p_advance),
      });
    }
    for (const g of Object.keys(groups)) groups[g].sort((a, b) => b.p_advance - a.p_advance);
    return {
      model_version: (sim?.[0]?.model_version as string) ?? MODEL_VERSION,
      sim_n: simN,
      computed_at: computedAt,
      groups,
      unavailable: false,
    };
  } catch {
    return empty;
  }
}

export async function getValueMarket(
  matchId: string,
  market: 'h2h' | 'totals',
  outcome: string,
): Promise<ValueMarketResponse> {
  const base: ValueMarketResponse = {
    match_id: matchId,
    market,
    outcome,
    market_available: false,
    pinnacle_main_point: null,
    pinnacle_novig: null,
    is_quarter_line: null,
    best_available: null,
    line_shopping: [],
    model_layer: null,
    freshness: null,
  };
  const client = getSupabase();
  if (!client) return base;
  try {
    const rows = await fetchLatestOdds(client, [matchId]);
    if (market === 'h2h') {
      const pinH2H: Record<string, number> = {};
      for (const r of rows) if (r.bookmaker === PINNACLE && r.market === 'h2h') pinH2H[r.outcome] = r.decimal_odds;
      const haveAll = ['home', 'draw', 'away'].every((o) => pinH2H[o] !== undefined);
      const p = haveAll ? novig({ home: pinH2H.home, draw: pinH2H.draw, away: pinH2H.away }) : null;
      const lineShopping = rows
        .filter((r) => r.market === 'h2h' && r.outcome === outcome)
        .map((r) => ({ book: r.bookmaker, decimal: r.decimal_odds }))
        .sort((a, b) => b.decimal - a.decimal);
      return {
        ...base,
        market_available: p !== null,
        pinnacle_novig: p ? (p[outcome] ?? null) : null,
        best_available: lineShopping[0] ?? null,
        line_shopping: lineShopping,
        freshness: freshnessOf(rows.filter((r) => r.bookmaker === PINNACLE && r.market === 'h2h')),
      };
    }

    // totals
    const mainPoint = pinnacleMainPoint(rows);
    let pinnacleNovig: number | null = null;
    if (mainPoint !== null) {
      const pin: Record<string, number> = {};
      for (const r of rows) {
        if (r.bookmaker === PINNACLE && r.market === 'totals' && r.point === mainPoint) pin[r.outcome] = r.decimal_odds;
      }
      if (pin.over !== undefined && pin.under !== undefined) {
        const p = novig({ over: pin.over, under: pin.under });
        pinnacleNovig = p[outcome] ?? null;
      }
    }
    const lineShopping =
      mainPoint === null
        ? []
        : rows
            .filter((r) => r.market === 'totals' && r.point === mainPoint && r.outcome === outcome)
            .map((r) => ({ book: r.bookmaker, decimal: r.decimal_odds }))
            .sort((a, b) => b.decimal - a.decimal);

    // model layer at the actual Pinnacle line (P3 §4.4 / §5.4) — experimental, isolated
    let modelLayer: ValueMarketResponse['model_layer'] = null;
    if (mainPoint !== null) {
      const { data: mtl } = await client
        .from('model_total_lines')
        .select('point,model_p_over,model_p_under,model_version')
        .eq('match_id', matchId)
        .eq('model_version', MODEL_VERSION)
        .eq('point', mainPoint)
        .limit(1);
      if (mtl && mtl[0]) {
        modelLayer = {
          model_version: mtl[0].model_version,
          point: Number(mtl[0].point),
          p_over: Number(mtl[0].model_p_over),
          p_under: Number(mtl[0].model_p_under),
        };
      }
    }

    return {
      ...base,
      market_available: pinnacleNovig !== null,
      pinnacle_main_point: mainPoint,
      pinnacle_novig: pinnacleNovig,
      is_quarter_line: mainPoint === null ? null : isQuarterLine(mainPoint),
      best_available: lineShopping[0] ?? null,
      line_shopping: lineShopping,
      model_layer: modelLayer,
      freshness: freshnessOf(rows.filter((r) => r.bookmaker === PINNACLE && r.market === 'totals')),
    };
  } catch {
    return base;
  }
}

export async function getFreshnessSummary(): Promise<FreshnessSummary> {
  const empty: FreshnessSummary = {
    elo_asof: null,
    odds_captured_at: null,
    sim_computed_at: null,
    unavailable: true,
  };
  const client = getSupabase();
  if (!client) return empty;
  try {
    const [{ data: team }, { data: odds }, { data: sim }] = await Promise.all([
      client.from('teams').select('elo_asof').order('elo_asof', { ascending: false }).limit(1),
      client.from('odds_snapshots').select('captured_at').order('captured_at', { ascending: false }).limit(1),
      client.from('group_sim').select('computed_at').order('computed_at', { ascending: false }).limit(1),
    ]);
    return {
      elo_asof: team?.[0]?.elo_asof ?? null,
      odds_captured_at: odds?.[0]?.captured_at ?? null,
      sim_computed_at: sim?.[0]?.computed_at ?? null,
      unavailable: false,
    };
  } catch {
    return empty;
  }
}
