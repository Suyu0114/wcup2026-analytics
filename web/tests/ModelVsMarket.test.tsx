// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import ModelVsMarket from '../components/ModelVsMarket';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

// TU2 (partial, auto) + TU3 (matches-side, auto). The "no single-answer layout" clause of TU2
// is a visual/design judgement and stays a manual check — we assert behaviour (what renders),
// not Tailwind classes.

const model = { home: 0.58, draw: 0.24, away: 0.18 }; // -> 58.0% / 24.0% / 18.0%
const market = { home: 0.55, draw: 0.25, away: 0.2 }; // -> 55.0% / 25.0% / 20.0%

describe('ModelVsMarket', () => {
  it('TU2: shows the market de-vig alongside the model, with an experimental tag, when odds exist', () => {
    renderWithIntl(<ModelVsMarket model={model} market={market} />);
    // both columns labelled
    expect(screen.getByText(en.matches.modelLabel)).toBeTruthy();
    expect(screen.getByText(en.matches.marketLabel)).toBeTruthy();
    // model carries an experimental tag (never a standalone answer)
    expect(screen.getAllByText(en.common.experimental).length).toBeGreaterThan(0);
    // model AND market probabilities are both rendered (side by side)
    expect(screen.getByText('58.0%')).toBeTruthy(); // model home
    expect(screen.getByText('55.0%')).toBeTruthy(); // market home
    // no "no market" note when odds are present
    expect(screen.queryByText(en.matches.noMarket)).toBeNull();
  });

  it('TU3: shows the model only with an explicit no-market note (no market bars, no crash) when odds are absent', () => {
    renderWithIntl(<ModelVsMarket model={model} market={null} />);
    // model still rendered
    expect(screen.getByText('58.0%')).toBeTruthy();
    // explicit, graceful no-market note — not an error
    expect(screen.getByText(en.matches.noMarket)).toBeTruthy();
    // market probabilities are NOT rendered
    expect(screen.queryByText('55.0%')).toBeNull();
    // still tagged experimental
    expect(screen.getAllByText(en.common.experimental).length).toBeGreaterThan(0);
  });
});
