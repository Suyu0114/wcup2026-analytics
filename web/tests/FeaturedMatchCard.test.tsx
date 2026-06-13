// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import FeaturedMatchCard from '../components/FeaturedMatchCard';
import type { MatchView } from '../lib/types';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

// v2 card is market-led: de-vig bars + risk tiers; the model appears ONLY in the
// scoreline hint (experimental tag). Real USA-v-Paraguay numbers (2026-06-12 snapshot).

const match: MatchView = {
  match_id: '537345',
  stage: 'group',
  group_label: 'D',
  kickoff_utc: '2026-06-13T01:00:00Z',
  status: 'scheduled',
  home: { team_id: 'US', name_en: 'United States', name_zh: '美國', elo: 1838 },
  away: { team_id: 'PY', name_en: 'Paraguay', name_zh: '巴拉圭', elo: 1771 },
  model: {
    model_version: 'dc-v1.1',
    lambda_home: 1.25,
    lambda_away: 1.15,
    p_home: 0.324,
    p_draw: 0.307,
    p_away: 0.368,
    p_over_2_5: 0.431,
    p_btts: null,
    exp_total_goals: 2.4,
    upset: { tier: null, weaker: null },
  },
  market: {
    pinnacle_novig: { home: 0.457, draw: 0.296, away: 0.247 },
    totals: { point: 2.5, over: 0.43, under: 0.57 },
    best_h2h: null,
    freshness: { captured_at: '2026-06-12T10:03:00Z', last_update: null, stale: false },
  },
  divergence: { flag: true, modelPick: 'away', marketPick: 'home' },
};

const renderCard = (m: MatchView) =>
  renderWithIntl(<FeaturedMatchCard match={m} locale="en" tz="UTC" isToday={true} />);

describe('FeaturedMatchCard (v2, market-led)', () => {
  it('shows market de-vig bars and risk tiers with market probabilities — no model 1X2', () => {
    renderCard(match);
    expect(screen.getByText(en.matches.marketLabel)).toBeTruthy();
    // market home 45.7% appears in the bar AND the medium tier row
    expect(screen.getAllByText('45.7%').length).toBe(2);
    // model 1X2 column absent
    expect(screen.queryByText(en.matches.modelLabel)).toBeNull();
    expect(screen.queryByText('32.4%')).toBeNull();

    // tiers: steady = 1X 75.3%, medium = home 45.7%, risky = away 24.7% (bar + row)
    expect(screen.getByText(en.featured.tierSteady)).toBeTruthy();
    expect(screen.getByText(en.featured.selDc.replace('{team}', 'United States'))).toBeTruthy();
    expect(screen.getByText('75.3%')).toBeTruthy();
    expect(screen.getAllByText('24.7%').length).toBe(2);
    // totals row: under-favoured at main line 2.5
    expect(screen.getByText(en.featured.selUnder.replace('{point}', '2.5'))).toBeTruthy();
    expect(screen.getByText('57.0%')).toBeTruthy();
    // probability ≠ value disclaimer always under the tiers
    expect(screen.getByText(en.featured.riskDisclaimer)).toBeTruthy();
  });

  it('keeps exactly one model trace: the scoreline hint with an experimental tag', () => {
    renderCard(match);
    expect(screen.getByText(new RegExp(en.featured.scorelineHint.split('{lines}')[0].trim()))).toBeTruthy();
    expect(screen.getAllByText(en.common.experimental).length).toBe(1);
    expect(screen.getByText(`${en.featured.fullModelLink} →`)).toBeTruthy();
  });

  it('reminder uses the MARKET favourite: USA not-win = 1 − 45.7% ≈ 54%', () => {
    renderCard(match);
    expect(
      screen.getByText(
        en.featured.notWinReminder.replace('{team}', 'United States').replace('{pct}', '54%'),
      ),
    ).toBeTruthy();
  });

  it('host home (US) shows the host-advantage line and tagline', () => {
    renderCard(match);
    expect(screen.getByText(en.featured.tagline_US)).toBeTruthy();
  });

  it('no market → graceful note, no tiers, no reminder; scoreline hint survives', () => {
    renderCard({ ...match, market: null, divergence: null });
    expect(screen.getByText(en.matches.noMarket)).toBeTruthy();
    expect(screen.queryByText(en.featured.riskHeading)).toBeNull();
    expect(screen.queryByText(en.featured.tierSteady)).toBeNull();
    expect(screen.queryByText(/chance of not winning/)).toBeNull();
    expect(screen.getByText(new RegExp(en.featured.scorelineHint.split('{lines}')[0].trim()))).toBeTruthy();
  });

  it('no model → no scoreline hint, market content unaffected', () => {
    renderCard({ ...match, model: null, divergence: null });
    expect(screen.queryByText(new RegExp(en.featured.scorelineHint.split('{lines}')[0].trim()))).toBeNull();
    expect(screen.getByText(en.featured.tierSteady)).toBeTruthy();
  });
});
