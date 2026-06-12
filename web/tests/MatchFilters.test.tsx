// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import MatchFilters from '../components/MatchFilters';
import type { MatchView } from '../lib/types';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

function makeMatch(p: {
  id: string;
  group: string;
  date: string; // YYYY-MM-DD
  upsetTier?: 'A+' | 'A' | 'B' | null;
  diverges?: boolean;
  homeName?: string;
}): MatchView {
  return {
    match_id: p.id,
    stage: 'group',
    group_label: p.group,
    kickoff_utc: `${p.date}T18:00:00Z`,
    status: 'scheduled',
    home: { team_id: `${p.id}H`, name_en: p.homeName ?? `${p.id} Home`, name_zh: null, elo: 1900 },
    away: { team_id: `${p.id}A`, name_en: `${p.id} Away`, name_zh: null, elo: 1800 },
    model: {
      model_version: 'dc-v1.0',
      p_home: 0.5,
      p_draw: 0.25,
      p_away: 0.25,
      p_over_2_5: 0.5,
      p_btts: 0.5,
      exp_total_goals: 2.6,
      upset: { tier: p.upsetTier ?? null, weaker: p.upsetTier ? `${p.id}A` : null },
    },
    market: null,
    divergence: p.diverges ? { flag: true, modelPick: 'home', marketPick: 'away' } : null,
  };
}

// m1: group A, 6/11, no upset | m2: group B, 6/12, upset A | m3: group A, 6/12, no upset
const matches: MatchView[] = [
  makeMatch({ id: 'm1', group: 'A', date: '2026-06-11' }),
  makeMatch({ id: 'm2', group: 'B', date: '2026-06-12', upsetTier: 'A' }),
  makeMatch({ id: 'm3', group: 'A', date: '2026-06-12' }),
];

function render(ms: MatchView[] = matches) {
  return renderWithIntl(<MatchFilters matches={ms} locale="en" tz="UTC" />);
}

describe('MatchFilters (client-side filter, Issue 7)', () => {
  it('shows all matches with a count initially', () => {
    render();
    expect(screen.getByText('Showing 3 of 3')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('filters by group', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByText('Showing 1 of 3')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Group B')).toBeTruthy();
    expect(screen.queryByText('Group A')).toBeNull();
  });

  it('filters to upsets only', () => {
    render();
    fireEvent.click(screen.getByRole('checkbox', { name: en.matches.filterUpset }));
    expect(screen.getAllByRole('article')).toHaveLength(1); // only m2 has upset tier
    expect(screen.getByText('Group B')).toBeTruthy();
  });

  it('filters to divergences only', () => {
    render([
      makeMatch({ id: 'd1', group: 'A', date: '2026-06-11', diverges: true }),
      makeMatch({ id: 'd2', group: 'A', date: '2026-06-11' }),
    ]);
    fireEvent.click(screen.getByRole('checkbox', { name: en.matches.filterDivergence }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Showing 1 of 2')).toBeTruthy();
  });

  it('filters by exact date via the date strip', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: /^6\/12/ }));
    expect(screen.getByText('Showing 2 of 3')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('filters by team name search (debounced)', async () => {
    render([
      makeMatch({ id: 'm1', group: 'A', date: '2026-06-11', homeName: 'Brazil' }),
      makeMatch({ id: 'm2', group: 'B', date: '2026-06-12', homeName: 'Germany' }),
    ]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'brazil' } });
    expect(await screen.findByText('Showing 1 of 2')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('shows a no-results message (not a crash) when filters exclude everything', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'A' })); // group A (m1, m3, no upset tier)
    fireEvent.click(screen.getByRole('checkbox', { name: en.matches.filterUpset })); // upsets only -> none
    expect(screen.getByText(en.matches.noResults)).toBeTruthy();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
