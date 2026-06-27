// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import ChampionOdds from '../components/ChampionOdds';
import type { KnockoutTeam } from '../lib/types';
import { renderWithIntl } from './testUtils';

afterEach(cleanup);

function team(id: string, champ: number): KnockoutTeam {
  return {
    team_id: id,
    name_en: id,
    name_zh: null,
    group_label: 'A',
    p_make_r16: 0.7,
    p_make_qf: 0.5,
    p_make_sf: 0.35,
    p_make_final: 0.25,
    p_champion: champ,
  };
}

describe('ChampionOdds', () => {
  it('is collapsed by default and shows the leader in the summary', () => {
    const { container } = renderWithIntl(
      <ChampionOdds teams={[team('ES', 0.168), team('AR', 0.153)]} locale="en" />,
    );
    const details = container.querySelector('details') as HTMLDetailsElement | null;
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false); // default collapsed → bracket below stays reachable
    expect(screen.getByText('ES 16.8% to win')).toBeTruthy(); // leader summary
  });

  it('renders nothing when there are no teams', () => {
    const { container } = renderWithIntl(<ChampionOdds teams={[]} locale="en" />);
    expect(container.querySelector('details')).toBeNull();
  });
});
