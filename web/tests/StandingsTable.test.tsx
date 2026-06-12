// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);
import StandingsTable from '../components/StandingsTable';
import type { StandingRow } from '../lib/types';

function makeRow(p: Partial<StandingRow> & { team_id: string; rank: number }): StandingRow {
  return {
    name_en: p.team_id,
    name_zh: null,
    group_label: 'A',
    played: 3,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
    tied: false,
    ...p,
  };
}

const teams: StandingRow[] = [
  makeRow({ team_id: 'AR', name_en: 'Argentina', rank: 1, pts: 9, wins: 3, gf: 6, ga: 1, gd: 5 }),
  makeRow({ team_id: 'BR', name_en: 'Brazil', rank: 2, pts: 6, wins: 2, losses: 1, gf: 4, ga: 3, gd: 1 }),
  makeRow({ team_id: 'DE', name_en: 'Germany', rank: 3, pts: 3, wins: 1, losses: 2, gf: 2, ga: 4, gd: -2, tied: true }),
  makeRow({ team_id: 'JP', name_en: 'Japan', rank: 4, pts: 3, wins: 1, losses: 2, gf: 1, ga: 5, gd: -4, tied: true }),
];

describe('StandingsTable', () => {
  it('renders teams in rank order with points and goal difference', () => {
    const { container } = renderWithIntl(<StandingsTable group="A" teams={teams} locale="en" />);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Argentina'),
      expect.stringContaining('Brazil'),
      expect.stringContaining('Germany'),
      expect.stringContaining('Japan'),
    ]);
    // signed GD + points present on the leader's row
    expect(rows[0].textContent).toContain('+5');
    expect(rows[0].textContent).toContain('9');
  });

  it('tiers the advancement border: 1st/2nd solid, 3rd dashed/lighter, 4th none (R2)', () => {
    const { container } = renderWithIntl(<StandingsTable group="A" teams={teams} locale="en" />);
    const firstCells = [...container.querySelectorAll('tbody tr')].map((r) => r.querySelector('td')!);
    expect(firstCells[0].className).toContain('border-emerald-500');
    expect(firstCells[1].className).toContain('border-emerald-500');
    expect(firstCells[2].className).toContain('border-dashed');
    expect(firstCells[2].className).toContain('border-emerald-300');
    expect(firstCells[3].className).toContain('border-transparent');
  });

  it('flags teams that remain level (tied) with the = marker', () => {
    const { getAllByTitle } = renderWithIntl(<StandingsTable group="A" teams={teams} locale="en" />);
    const marks = getAllByTitle(en.standings.tiedTooltip);
    expect(marks).toHaveLength(2); // Germany + Japan
    expect(marks.every((m) => m.textContent === '=')).toBe(true);
  });
});
