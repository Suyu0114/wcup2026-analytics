import { describe, it, expect } from 'vitest';
import { selectFeatured, isKickoffToday } from '../lib/featured';
import type { MatchView } from '../lib/types';

// Selection is a display fact: kickoff order + finished filter. "Finished" is
// status==='final' OR an admin score already entered in manual_results (the
// cards advance before the recompute pipeline settles the match).

const mk = (id: string, kickoff: string, status = 'scheduled', stage = 'group'): MatchView => ({
  match_id: id,
  stage,
  group_label: stage === 'group' ? 'B' : null,
  match_no: stage === 'group' ? null : 97,
  kickoff_utc: kickoff,
  status,
  home: { team_id: 'CA', name_en: 'Canada', name_zh: null, elo: 1800 },
  away: { team_id: 'BA', name_en: 'Bosnia and Herzegovina', name_zh: null, elo: 1700 },
  home_goals: null,
  away_goals: null,
  winner: null,
  result_duration: null,
  model: null,
  market: null,
  divergence: null,
});

describe('selectFeatured', () => {
  it('takes the next 3 unfinished matches in kickoff order', () => {
    const matches = [
      mk('4', '2026-06-15T00:00:00Z'),
      mk('1', '2026-06-12T00:00:00Z'),
      mk('3', '2026-06-14T00:00:00Z'),
      mk('2', '2026-06-13T00:00:00Z'),
    ];
    expect(selectFeatured(matches, {}).map((m) => m.match_id)).toEqual(['1', '2', '3']);
  });

  it('skips status=final', () => {
    const matches = [
      mk('1', '2026-06-12T00:00:00Z', 'final'),
      mk('2', '2026-06-13T00:00:00Z'),
      mk('3', '2026-06-14T00:00:00Z'),
    ];
    expect(selectFeatured(matches, {}).map((m) => m.match_id)).toEqual(['2', '3']);
  });

  it('skips matches with a manual result even before status flips', () => {
    const matches = [
      mk('1', '2026-06-12T00:00:00Z'), // still 'scheduled' but admin entered a score
      mk('2', '2026-06-13T00:00:00Z'),
    ];
    const manual = { '1': { home: 2, away: 1 } };
    expect(selectFeatured(matches, manual).map((m) => m.match_id)).toEqual(['2']);
  });

  it('keeps live matches visible', () => {
    const matches = [mk('1', '2026-06-12T00:00:00Z', 'live')];
    expect(selectFeatured(matches, {}).map((m) => m.match_id)).toEqual(['1']);
  });

  it('returns fewer than count when not enough remain, empty when none', () => {
    expect(selectFeatured([mk('1', '2026-06-12T00:00:00Z')], {})).toHaveLength(1);
    expect(selectFeatured([], {})).toEqual([]);
  });

  it('respects a custom count', () => {
    const matches = [
      mk('1', '2026-06-12T00:00:00Z'),
      mk('2', '2026-06-13T00:00:00Z'),
      mk('3', '2026-06-14T00:00:00Z'),
    ];
    expect(selectFeatured(matches, {}, 2)).toHaveLength(2);
  });

  it('features knockout matches once the group stage is all final (P17)', () => {
    const matches = [
      mk('g1', '2026-06-12T00:00:00Z', 'final'),           // settled group match
      mk('qf1', '2026-07-09T20:00:00Z', 'scheduled', 'qf'), // upcoming quarter-final
    ];
    expect(selectFeatured(matches, {}).map((m) => m.match_id)).toEqual(['qf1']);
  });
});

describe('isKickoffToday', () => {
  // 2026-06-12T18:00Z = 06-13 02:00 in Taipei but 06-12 14:00 in Toronto —
  // the same kickoff is "today" or not depending on the site timezone.
  const kickoff = '2026-06-12T18:00:00Z';
  const now = new Date('2026-06-12T12:00:00Z');

  it('is tz-aware (differs between Taipei and Toronto)', () => {
    expect(isKickoffToday(kickoff, 'Asia/Taipei', now)).toBe(false);
    expect(isKickoffToday(kickoff, 'America/Toronto', now)).toBe(true);
  });

  it('false for a different day in both zones', () => {
    const tomorrow = '2026-06-13T18:00:00Z';
    expect(isKickoffToday(tomorrow, 'America/Toronto', now)).toBe(false);
  });
});
