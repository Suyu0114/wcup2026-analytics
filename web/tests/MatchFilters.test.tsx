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
  upset: boolean;
}): MatchView {
  return {
    match_id: p.id,
    stage: 'group',
    group_label: p.group,
    kickoff_utc: `${p.date}T18:00:00Z`,
    status: 'scheduled',
    home: { team_id: `${p.id}H`, name_en: `${p.id} Home`, name_zh: null, elo: 1900 },
    away: { team_id: `${p.id}A`, name_en: `${p.id} Away`, name_zh: null, elo: 1800 },
    model: {
      model_version: 'dc-v1.0',
      p_home: 0.5,
      p_draw: 0.25,
      p_away: 0.25,
      p_over_2_5: 0.5,
      p_btts: 0.5,
      exp_total_goals: 2.6,
      upset: { flag: p.upset, weaker: p.upset ? `${p.id}A` : null },
    },
    market: null,
    divergence: null,
  };
}

// m1: group A, 6/11, no upset | m2: group B, 6/12, upset | m3: group A, 6/12, no upset
const matches: MatchView[] = [
  makeMatch({ id: 'm1', group: 'A', date: '2026-06-11', upset: false }),
  makeMatch({ id: 'm2', group: 'B', date: '2026-06-12', upset: true }),
  makeMatch({ id: 'm3', group: 'A', date: '2026-06-12', upset: false }),
];

function render() {
  return renderWithIntl(<MatchFilters matches={matches} locale="en" tz="UTC" />);
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
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getAllByRole('article')).toHaveLength(1); // only m2 has upset flag
    expect(screen.getByText('Group B')).toBeTruthy();
  });

  it('filters by exact date', () => {
    render();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-06-12' } });
    expect(screen.getByText('Showing 2 of 3')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('shows a no-results message (not a crash) when filters exclude everything', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'A' })); // group A (m1, m3, both non-upset)
    fireEvent.click(screen.getByRole('checkbox')); // upsets only -> none
    expect(screen.getByText(en.matches.noResults)).toBeTruthy();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
