import 'server-only';
import { getSupabase } from './supabaseServer';
import { novig } from './devig';
import { computeUpset } from './upset';
import { computeDivergence, argmaxOutcome } from './divergence';
import { result1x2, brier, classifyUpset } from './score';
import { isQuarterLine } from './value';
import {
  MODEL_VERSION,
  PINNACLE,
  FRESH_WINDOW_MS,
  KELLY_UNLOCK_N,
  KELLY_UNLOCK_BRIER_RATIO,
  type UpsetTier,
} from './constants';
import type {
  MatchesResponse,
  MatchView,
  MatchMarket,
  GroupsResponse,
  GroupTeam,
  ValueMarketResponse,
  CalibrationStatus,
  ModelTotalsGridEntry,
  BookPrice,
  Freshness,
  FreshnessSummary,
  FixturesResponse,
  FixtureView,
  StandingsResponse,
  StandingRow,
  TrackRecordResponse,
  TrackRecordRow,
  TrackRecordSummary,
  TrackRecordTierStat,
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

  // pinnacle totals main line, de-vig (featured-card display; same main-line rule as /value)
  let totals: MatchMarket['totals'] = null;
  const mainPoint = pinnacleMainPoint(rows);
  if (mainPoint !== null) {
    const pin: Record<string, number> = {};
    for (const r of rows) {
      if (r.bookmaker === PINNACLE && r.market === 'totals' && r.point === mainPoint) pin[r.outcome] = r.decimal_odds;
    }
    if (pin.over !== undefined && pin.under !== undefined) {
      const p = novig({ over: pin.over, under: pin.under });
      totals = { point: mainPoint, over: p.over, under: p.under };
    }
  }

  return {
    pinnacle_novig: pinnacleNovig,
    totals,
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
          .select('match_id,lambda_home,lambda_away,p_home,p_draw,p_away,p_over_2_5,p_btts,exp_total_goals')
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
            lambda_home: Number(pred.lambda_home),
            lambda_away: Number(pred.lambda_away),
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
      const market = buildMatchMarket(oddsByMatch.get(m.match_id) ?? []);
      const divergence = model
        ? computeDivergence(
            { home: model.p_home, draw: model.p_draw, away: model.p_away },
            market?.pinnacle_novig ?? null,
          )
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
        market,
        divergence,
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

/** All stored matches with actual scores (P8 /results). Fetches EVERY stage (not just
 * group) so the page can switch on `stage`; knockout rows simply don't exist until the
 * draw is ingested (FK requires teams). Lean: no predictions/odds — results are facts. */
export async function getFixtures(): Promise<FixturesResponse> {
  const client = getSupabase();
  if (!client) return { fixtures: [], unavailable: true };
  try {
    const [{ data: teams, error: te }, { data: matches, error: me }] = await Promise.all([
      client.from('teams').select('team_id,name_en,name_zh,elo'),
      client
        .from('matches')
        .select('match_id,stage,group_label,home_team,away_team,kickoff_utc,status,home_goals,away_goals'),
    ]);
    if (te || me) throw te || me;
    const teamMap = new Map((teams ?? []).map((t) => [t.team_id, t]));
    const fixtures: FixtureView[] = [];
    for (const m of matches ?? []) {
      const home = teamMap.get(m.home_team);
      const away = teamMap.get(m.away_team);
      if (!home || !away) continue; // contract violation skipped defensively
      fixtures.push({
        match_id: m.match_id,
        stage: m.stage,
        group_label: m.group_label,
        kickoff_utc: m.kickoff_utc,
        status: m.status,
        home: { team_id: home.team_id, name_en: home.name_en, name_zh: home.name_zh, elo: Number(home.elo) },
        away: { team_id: away.team_id, name_en: away.name_en, name_zh: away.name_zh, elo: Number(away.elo) },
        home_goals: m.home_goals === null ? null : Number(m.home_goals),
        away_goals: m.away_goals === null ? null : Number(m.away_goals),
      });
    }
    fixtures.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
    return { fixtures, unavailable: false };
  } catch {
    return { fixtures: [], unavailable: true };
  }
}

/** Actual group standings (P8 /standings). A FACT — no model_version filter (cf. getGroups,
 * do not copy the .eq there). Pre-migration the table is absent → query throws → unavailable
 * (graceful, §6.6). */
export async function getStandings(): Promise<StandingsResponse> {
  const empty: StandingsResponse = { groups: {}, computed_at: null, unavailable: true };
  const client = getSupabase();
  if (!client) return empty;
  try {
    const [{ data: rows, error: se }, { data: teams, error: te }] = await Promise.all([
      client
        .from('group_standings')
        .select('team_id,group_label,played,wins,draws,losses,gf,ga,gd,pts,rank,tied,computed_at'),
      client.from('teams').select('team_id,name_en,name_zh'),
    ]);
    if (se || te) throw se || te;
    const teamMap = new Map((teams ?? []).map((t) => [t.team_id, t]));
    const groups: Record<string, StandingRow[]> = {};
    let computedAt: string | null = null;
    for (const r of rows ?? []) {
      computedAt = r.computed_at;
      const t = teamMap.get(r.team_id);
      (groups[r.group_label] ??= []).push({
        team_id: r.team_id,
        name_en: t?.name_en ?? r.team_id,
        name_zh: t?.name_zh ?? null,
        group_label: r.group_label,
        played: Number(r.played),
        wins: Number(r.wins),
        draws: Number(r.draws),
        losses: Number(r.losses),
        gf: Number(r.gf),
        ga: Number(r.ga),
        gd: Number(r.gd),
        pts: Number(r.pts),
        rank: Number(r.rank),
        tied: Boolean(r.tied),
      });
    }
    for (const g of Object.keys(groups)) groups[g].sort((a, b) => a.rank - b.rank);
    return { groups, computed_at: computedAt, unavailable: false };
  } catch {
    return empty;
  }
}

/** Latest calibration_runs row for the active version; kelly_unlocked judged here,
 * server-side (P6 §3.5 / TB12). Table may not exist pre-DDL → null (graceful). */
async function fetchCalibration(
  client: NonNullable<ReturnType<typeof getSupabase>>,
): Promise<CalibrationStatus | null> {
  try {
    const { data, error } = await client
      .from('calibration_runs')
      .select('model_version,run_at,n_settled,model_brier,market_brier')
      .eq('model_version', MODEL_VERSION)
      .order('run_at', { ascending: false })
      .limit(1);
    if (error || !data?.[0]) return null;
    const c = data[0];
    const modelBrier = c.model_brier === null ? null : Number(c.model_brier);
    const marketBrier = c.market_brier === null ? null : Number(c.market_brier);
    const unlocked =
      Number(c.n_settled) >= KELLY_UNLOCK_N &&
      modelBrier !== null &&
      marketBrier !== null &&
      modelBrier <= marketBrier * KELLY_UNLOCK_BRIER_RATIO;
    return {
      model_version: c.model_version,
      run_at: c.run_at,
      n_settled: Number(c.n_settled),
      model_brier: modelBrier,
      market_brier: marketBrier,
      kelly_unlocked: unlocked,
    };
  } catch {
    return null;
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
    model_h2h: null,
    model_totals_grid: null,
    calibration: null,
    freshness: null,
  };
  const client = getSupabase();
  if (!client) return base;
  try {
    const rows = await fetchLatestOdds(client, [matchId]);
    const calibration = await fetchCalibration(client);

    if (market === 'h2h') {
      const pinH2H: Record<string, number> = {};
      for (const r of rows) if (r.bookmaker === PINNACLE && r.market === 'h2h') pinH2H[r.outcome] = r.decimal_odds;
      const haveAll = ['home', 'draw', 'away'].every((o) => pinH2H[o] !== undefined);
      const p = haveAll ? novig({ home: pinH2H.home, draw: pinH2H.draw, away: pinH2H.away }) : null;
      const lineShopping = rows
        .filter((r) => r.market === 'h2h' && r.outcome === outcome)
        .map((r) => ({ book: r.bookmaker, decimal: r.decimal_odds }))
        .sort((a, b) => b.decimal - a.decimal);

      // model side (P6 §5) — separate object; consumed only in model mode
      let modelH2h: ValueMarketResponse['model_h2h'] = null;
      try {
        const { data: mp } = await client
          .from('match_predictions')
          .select('model_version,p_home,p_draw,p_away')
          .eq('match_id', matchId)
          .eq('model_version', MODEL_VERSION)
          .limit(1);
        if (mp?.[0]) {
          modelH2h = {
            model_version: mp[0].model_version,
            p_home: Number(mp[0].p_home),
            p_draw: Number(mp[0].p_draw),
            p_away: Number(mp[0].p_away),
          };
        }
      } catch {
        modelH2h = null;
      }

      return {
        ...base,
        market_available: p !== null,
        pinnacle_novig: p ? (p[outcome] ?? null) : null,
        best_available: lineShopping[0] ?? null,
        line_shopping: lineShopping,
        model_h2h: modelH2h,
        calibration,
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

    // model totals grid 1.5–4.5 + push (P6 §3.4; replaces model_layer). Pre-DDL the
    // model_p_push column may not exist → null grid (graceful §6.6).
    let grid: ModelTotalsGridEntry[] | null = null;
    try {
      const { data: mtl, error: ge } = await client
        .from('model_total_lines')
        .select('point,model_p_over,model_p_under,model_p_push')
        .eq('match_id', matchId)
        .eq('model_version', MODEL_VERSION);
      if (!ge && mtl && mtl.length > 0) {
        grid = mtl
          .map((g) => ({
            point: Number(g.point),
            p_over: Number(g.model_p_over),
            p_under: Number(g.model_p_under),
            p_push: Number(g.model_p_push),
          }))
          .sort((a, b) => a.point - b.point);
      }
    } catch {
      grid = null;
    }

    return {
      ...base,
      market_available: pinnacleNovig !== null,
      pinnacle_main_point: mainPoint,
      pinnacle_novig: pinnacleNovig,
      is_quarter_line: mainPoint === null ? null : isQuarterLine(mainPoint),
      best_available: lineShopping[0] ?? null,
      line_shopping: lineShopping,
      model_totals_grid: grid,
      calibration,
      freshness: freshnessOf(rows.filter((r) => r.bookmaker === PINNACLE && r.market === 'totals')),
    };
  } catch {
    return base;
  }
}

const ZERO_TIER: TrackRecordTierStat = { total: 0, notLost: 0, won: 0 };

function emptyTrackSummary(): TrackRecordSummary {
  return {
    model: null,
    market: null,
    upset: { total: 0, notLost: 0, won: 0, byTier: { 'A+': { ...ZERO_TIER }, A: { ...ZERO_TIER }, B: { ...ZERO_TIER } } },
  };
}

function summarizeTrackRecord(rows: TrackRecordRow[]): TrackRecordSummary {
  const model = rows.length
    ? {
        n: rows.length,
        correct: rows.filter((r) => r.model.hit).length,
        brier: rows.reduce((s, r) => s + r.model.brier, 0) / rows.length,
      }
    : null;
  const withMarket = rows.filter((r) => r.market !== null);
  const market = withMarket.length
    ? {
        n: withMarket.length,
        correct: withMarket.filter((r) => r.market!.hit).length,
        brier: withMarket.reduce((s, r) => s + r.market!.brier, 0) / withMarket.length,
      }
    : null;
  const tagged = rows.filter((r) => r.upset !== null);
  const byTier = {} as Record<UpsetTier, TrackRecordTierStat>;
  for (const tier of ['A+', 'A', 'B'] as UpsetTier[]) {
    const g = tagged.filter((r) => r.upset!.tier === tier);
    byTier[tier] = {
      total: g.length,
      notLost: g.filter((r) => r.upset!.result !== 'lost').length,
      won: g.filter((r) => r.upset!.result === 'won').length,
    };
  }
  return {
    model,
    market,
    upset: {
      total: tagged.length,
      notLost: tagged.filter((r) => r.upset!.result !== 'lost').length,
      won: tagged.filter((r) => r.upset!.result === 'won').length,
      byTier,
    },
  };
}

/** Prediction track record (P9): settled group matches scored against actual results, model
 * shown alongside the market (trap #7), plus the upset-tag audit. Predictions are the frozen
 * pre-tournament model (predict is not re-run per match — P9-spec §2), so each row reproduces
 * the PRE-MATCH prediction and the SAME upset tag the featured card showed. Group stage only
 * (where predictions/upset tags surface); knockout is a later extension (drop the stage filter).
 * Any failure → unavailable (graceful, §6.6). */
export async function getTrackRecord(): Promise<TrackRecordResponse> {
  const empty: TrackRecordResponse = { rows: [], summary: emptyTrackSummary(), unavailable: true };
  const client = getSupabase();
  if (!client) return empty;
  try {
    const [{ data: teams, error: te }, { data: matches, error: me }, { data: preds, error: pe }] =
      await Promise.all([
        client.from('teams').select('team_id,name_en,name_zh,elo'),
        client
          .from('matches')
          .select('match_id,stage,group_label,home_team,away_team,kickoff_utc,status,home_goals,away_goals')
          .eq('stage', 'group')
          .eq('status', 'final'),
        client
          .from('match_predictions')
          .select('match_id,p_home,p_draw,p_away')
          .eq('model_version', MODEL_VERSION),
      ]);
    if (te || me || pe) throw te || me || pe;

    // settled = final AND both goals present (same gate as etl/calibrate.py)
    const settled = (matches ?? []).filter((m) => m.home_goals !== null && m.away_goals !== null);
    const teamMap = new Map((teams ?? []).map((t) => [t.team_id, t]));
    const predMap = new Map((preds ?? []).map((p) => [p.match_id, p]));

    // odds optional — failure must not hide the track record (graceful, §6.6)
    let oddsByMatch = new Map<string, OddsRow[]>();
    const ids = settled.map((m) => m.match_id);
    try {
      if (ids.length > 0) {
        const oddsRows = await fetchLatestOdds(client, ids);
        oddsByMatch = oddsRows.reduce((acc, r) => {
          (acc.get(r.match_id) ?? acc.set(r.match_id, []).get(r.match_id)!).push(r);
          return acc;
        }, new Map<string, OddsRow[]>());
      }
    } catch {
      oddsByMatch = new Map();
    }

    const rows: TrackRecordRow[] = [];
    for (const m of settled) {
      const home = teamMap.get(m.home_team);
      const away = teamMap.get(m.away_team);
      const pred = predMap.get(m.match_id);
      if (!home || !away || !pred) continue; // need both teams + a pre-match prediction to score
      const hg = Number(m.home_goals);
      const ag = Number(m.away_goals);
      const actual = result1x2(hg, ag);

      const modelT = { home: Number(pred.p_home), draw: Number(pred.p_draw), away: Number(pred.p_away) };
      const modelPick = argmaxOutcome(modelT);
      const model = {
        p_home: modelT.home,
        p_draw: modelT.draw,
        p_away: modelT.away,
        pick: modelPick,
        hit: modelPick === actual,
        brier: brier(modelT, actual),
      };

      const novigT = buildMatchMarket(oddsByMatch.get(m.match_id) ?? [])?.pinnacle_novig ?? null;
      const market = novigT
        ? (() => {
            const marketPick = argmaxOutcome(novigT);
            return {
              p_home: novigT.home,
              p_draw: novigT.draw,
              p_away: novigT.away,
              pick: marketPick,
              hit: marketPick === actual,
              brier: brier(novigT, actual),
            };
          })()
        : null;

      const up = computeUpset({
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        eloHome: Number(home.elo),
        eloAway: Number(away.elo),
        pHome: modelT.home,
        pDraw: modelT.draw,
        pAway: modelT.away,
      });
      const upset =
        up.tier && up.weaker
          ? { tier: up.tier, weaker: up.weaker, result: classifyUpset(up.weaker, m.home_team, hg, ag) }
          : null;

      rows.push({
        match_id: m.match_id,
        stage: m.stage,
        group_label: m.group_label,
        kickoff_utc: m.kickoff_utc,
        home: { team_id: home.team_id, name_en: home.name_en, name_zh: home.name_zh, elo: Number(home.elo) },
        away: { team_id: away.team_id, name_en: away.name_en, name_zh: away.name_zh, elo: Number(away.elo) },
        home_goals: hg,
        away_goals: ag,
        actual,
        model,
        market,
        upset,
      });
    }
    rows.sort((a, b) => b.kickoff_utc.localeCompare(a.kickoff_utc)); // most recent first
    return { rows, summary: summarizeTrackRecord(rows), unavailable: false };
  } catch {
    return empty;
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
