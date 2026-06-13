// Home-page featured cards: pick the next unfinished matches (display FACT —
// kickoff order + finished filter, no model logic). A match counts as finished
// when matches.status='final' OR an admin score already sits in manual_results;
// the latter advances the cards the moment a score is entered, without waiting
// for the recompute pipeline to settle the match.
import type { MatchView } from './types';
import { FEATURED_COUNT } from './constants';

export function selectFeatured(
  matches: MatchView[],
  manualResults: Record<string, unknown>,
  count: number = FEATURED_COUNT,
): MatchView[] {
  return matches
    .filter((m) => m.status !== 'final' && !(m.match_id in manualResults))
    .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc))
    .slice(0, count);
}

/** Same calendar day as `now` in the site timezone — drives the "today" badge. */
export function isKickoffToday(kickoffUtc: string, tz: string, now: Date = new Date()): boolean {
  // en-CA → YYYY-MM-DD, an unambiguous day key within tz.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' });
  return fmt.format(new Date(kickoffUtc)) === fmt.format(now);
}
