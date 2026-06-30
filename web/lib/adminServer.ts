import 'server-only';
import { getSupabase } from './supabaseServer';

// Admin-only server helpers (P7): read/write manual_results + trigger the recompute
// workflow. Writes go through the service-key client (server-only), never the client.

export interface ManualScore {
  home: number;
  away: number;
  // P12: curated score is authoritative even against a conflicting non-null fd score.
  overrideFd: boolean;
}

/** {match_id: {home, away, overrideFd}} already entered, for prefilling the admin form. */
export async function getManualResults(): Promise<Record<string, ManualScore>> {
  const client = getSupabase();
  if (!client) return {};
  const { data, error } = await client
    .from('manual_results')
    .select('match_id,home_goals,away_goals,override_fd');
  if (error || !data) return {};
  const out: Record<string, ManualScore> = {};
  for (const r of data)
    out[r.match_id] = { home: r.home_goals, away: r.away_goals, overrideFd: !!r.override_fd };
  return out;
}

/** Upsert one curated result (idempotent on match_id). Throws if the DB is unavailable.
 *  overrideFd=true (P12) tells the ingest the curated score wins over a *conflicting*
 *  non-null football-data score (fd is wrong) instead of failing loud. */
export async function writeManualResult(
  matchId: string,
  homeGoals: number,
  awayGoals: number,
  overrideFd = false,
): Promise<void> {
  const client = getSupabase();
  if (!client) throw new Error('Supabase unavailable');
  const { error } = await client.from('manual_results').upsert(
    [
      {
        match_id: matchId,
        home_goals: homeGoals,
        away_goals: awayGoals,
        entered_by: 'admin',
        note: 'entered via admin page',
        override_fd: overrideFd,
      },
    ],
    { onConflict: 'match_id' },
  );
  if (error) throw error;
}

/** Fire the recompute GitHub Actions workflow via repository_dispatch. Returns success. */
export async function triggerRecompute(): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO ?? 'Suyu0114/wcup2026-analytics';
  if (!token) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'recompute-request' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
