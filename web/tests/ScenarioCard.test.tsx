// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);
import ScenarioCard from '../components/ScenarioCard';
import { formatPercent } from '../lib/format';
import type { MatchScenarioView, TeamOutcomeView } from '../lib/types';

function mo(team_id: string, status: string, basis_key: string, extra: Partial<TeamOutcomeView> = {}): TeamOutcomeView {
  return {
    team_id,
    name_en: team_id,
    name_zh: null,
    status,
    can_win_group: false,
    secured_3rd_or_better: false,
    needs_best_third: false,
    seeding_live: false,
    basis_key,
    ...extra,
  };
}

const team = (team_id: string, name_en: string) => ({ team_id, name_en, name_zh: null, elo: 2000 });

const convenience: MatchScenarioView = {
  match_id: 'ARBR',
  group_label: 'A',
  kickoff_utc: '2026-06-20T00:00:00Z',
  home: team('AR', 'Argentina'),
  away: team('BR', 'Brazil'),
  outcomes: {
    home: [mo('AR', 'top2_clinched', 'clinched_first'), mo('BR', 'alive', 'alive_can_third')],
    draw: [
      mo('AR', 'top2_clinched', 'clinched_top2', { seeding_live: true }),
      mo('BR', 'top2_clinched', 'clinched_top2', { seeding_live: true }),
    ],
    away: [mo('AR', 'alive', 'alive_can_third'), mo('BR', 'top2_clinched', 'clinched_first')],
  },
  convenience_draw: true,
  convenience_draw_kind: 'top2',
  dead_rubber: false,
};

const dead: MatchScenarioView = {
  match_id: 'MXJP',
  group_label: 'B',
  kickoff_utc: '2026-06-21T00:00:00Z',
  home: team('MX', 'Mexico'),
  away: team('JP', 'Japan'),
  outcomes: {
    home: [mo('MX', 'top2_clinched', 'clinched_first'), mo('JP', 'eliminated', 'eliminated')],
    draw: [mo('MX', 'top2_clinched', 'clinched_first'), mo('JP', 'eliminated', 'eliminated')],
    away: [mo('MX', 'top2_clinched', 'clinched_first'), mo('JP', 'eliminated', 'eliminated')],
  },
  convenience_draw: false,
  convenience_draw_kind: null,
  dead_rubber: true,
};

describe('ScenarioCard', () => {
  it('flags a strong convenience draw and the still-live seeding', () => {
    const { getByText, getAllByText } = renderWithIntl(<ScenarioCard scenario={convenience} locale="en" />);
    expect(getByText(en.scenarios.convenienceDraw)).toBeTruthy();
    expect(getAllByText(en.scenarios.basis_clinched_top2).length).toBe(2); // both teams under the draw
    expect(getAllByText(en.scenarios.seedingLive).length).toBe(2);
  });

  it('labels a dead rubber as having no bearing on qualification', () => {
    const { getByText } = renderWithIntl(<ScenarioCard scenario={dead} locale="en" />);
    expect(getByText(en.scenarios.deadRubber)).toBeTruthy();
  });

  it('overlays the experimental model probability only on alive teams', () => {
    const probByTeam = new Map([['BR', 0.67]]);
    const { container } = renderWithIntl(
      <ScenarioCard scenario={convenience} locale="en" probByTeam={probByTeam} />,
    );
    // BR is alive under the home-win column → probability overlaid, flagged experimental.
    expect(container.textContent).toContain(formatPercent(0.67));
    expect(container.textContent).toContain('experimental');
    // Guardrail (spec §7): the probability phrasing itself must not read like a clinch.
    expect(en.scenarios.probAdvance.toLowerCase()).not.toMatch(/clinch|guaranteed|certain/);
  });
});
