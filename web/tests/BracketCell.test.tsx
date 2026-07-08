// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import BracketCell from '../components/BracketCell';
import { bracketMatch } from '../lib/bracket';
import type { MatchView } from '../lib/types';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

// P17 cell precedence: real match (fact) > projected occupant (model) > slot label.

const m73 = bracketMatch(73)!;

function realMatch(p: {
  status?: string;
  hg?: number | null;
  ag?: number | null;
  winner?: 'home' | 'away' | null;
  duration?: 'regular' | 'et' | 'pk' | null;
}): MatchView {
  return {
    match_id: '537417',
    stage: 'r32',
    group_label: null,
    match_no: 73,
    kickoff_utc: '2026-06-28T19:00:00Z',
    status: p.status ?? 'final',
    home: { team_id: 'ZA', name_en: 'South Africa', name_zh: null, elo: 1700 },
    away: { team_id: 'CA', name_en: 'Canada', name_zh: null, elo: 1800 },
    home_goals: p.hg === undefined ? null : p.hg,
    away_goals: p.ag === undefined ? null : p.ag,
    winner: p.winner ?? null,
    result_duration: p.duration ?? null,
    model: null,
    market: null,
    divergence: null,
  };
}

const projected73 = {
  '73-home': { match_no: 73, side: 'home' as const, team_id: 'BR', name_en: 'Brazil', name_zh: null, prob: 0.6 },
};

describe('BracketCell (P17 real-match precedence)', () => {
  it('renders the slot labels when neither real nor projected exists', () => {
    renderWithIntl(<BracketCell match={m73} locale="en" />);
    // m73 = runner-up A vs runner-up B
    expect(screen.getByText('Runner-up A')).toBeTruthy();
    expect(screen.getByText('Runner-up B')).toBeTruthy();
  });

  it('renders the projected occupant when no real match exists', () => {
    renderWithIntl(<BracketCell match={m73} projected={projected73} locale="en" />);
    expect(screen.getByText('Brazil')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy(); // not certain -> prob shown
  });

  it('prefers the real match over the projected occupant', () => {
    renderWithIntl(
      <BracketCell
        match={m73}
        projected={projected73}
        real={{ 73: realMatch({ hg: 2, ag: 0 }) }}
        locale="en"
      />,
    );
    expect(screen.getByText('South Africa')).toBeTruthy();
    expect(screen.getByText('Canada')).toBeTruthy();
    expect(screen.queryByText('Brazil')).toBeNull(); // model occupant superseded
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('marks a penalty shootout (fd fullTime is cumulative, e.g. 3-4 after pens)', () => {
    renderWithIntl(
      <BracketCell
        match={m73}
        real={{ 73: realMatch({ hg: 3, ag: 4, winner: 'away', duration: 'pk' }) }}
        locale="en"
      />,
    );
    expect(screen.getByText(en.bracket.pk)).toBeTruthy(); // PK marker on the winner row
  });

  it('marks an extra-time win with aet', () => {
    renderWithIntl(
      <BracketCell
        match={m73}
        real={{ 73: realMatch({ hg: 2, ag: 1, duration: 'et' }) }}
        locale="en"
      />,
    );
    expect(screen.getByText(en.bracket.aet)).toBeTruthy();
  });

  it('shows teams without a score for a scheduled real match', () => {
    renderWithIntl(
      <BracketCell match={m73} real={{ 73: realMatch({ status: 'scheduled' }) }} locale="en" />,
    );
    expect(screen.getByText('South Africa')).toBeTruthy();
    expect(screen.queryByText(en.bracket.pk)).toBeNull();
  });
});
