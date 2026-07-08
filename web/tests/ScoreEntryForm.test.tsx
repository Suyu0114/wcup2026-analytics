// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ScoreEntryForm, { type MatchOption } from '../components/admin/ScoreEntryForm';

afterEach(cleanup);

// Admin is hardcoded zh (no i18n provider needed). P17: knockout options carry a stage
// prefix and a level knockout score surfaces the after-ET / PK guidance.

const options: MatchOption[] = [
  {
    matchId: 'g1',
    group: 'A',
    stage: 'group',
    homeName: '墨西哥',
    awayName: '南非',
    kickoff: '2026-06-11T19:00:00Z',
    settled: true,
    existing: { home: 2, away: 1, overrideFd: false },
  },
  {
    matchId: 'qf1',
    group: null,
    stage: 'qf',
    homeName: '巴西',
    awayName: '法國',
    kickoff: '2026-07-09T20:00:00Z',
    settled: false,
    existing: null,
  },
];

describe('ScoreEntryForm (P17 knockout entry)', () => {
  it('labels knockout options with the stage instead of a group', () => {
    render(<ScoreEntryForm matches={options} />);
    expect(screen.getByRole('option', { name: /八強 · 巴西 vs 法國/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /A組 · 墨西哥 vs 南非/ })).toBeTruthy();
  });

  it('shows the total-score note for a knockout match, and the PK hint on a level score', () => {
    render(<ScoreEntryForm matches={options} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qf1' } });
    expect(screen.getByText(/最終總比分/)).toBeTruthy();
    expect(screen.queryByText(/晉級機率抽樣/)).toBeNull(); // no score entered yet

    const [homeInput, awayInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(homeInput, { target: { value: '1' } });
    fireEvent.change(awayInput, { target: { value: '1' } });
    expect(screen.getByText(/晉級機率抽樣/)).toBeTruthy(); // level -> PK transient hint

    fireEvent.change(awayInput, { target: { value: '2' } });
    expect(screen.queryByText(/晉級機率抽樣/)).toBeNull(); // decisive -> hint gone
  });

  it('shows no knockout note for a group match', () => {
    render(<ScoreEntryForm matches={options} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'g1' } });
    expect(screen.queryByText(/最終總比分/)).toBeNull();
  });
});
