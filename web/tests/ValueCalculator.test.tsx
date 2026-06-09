// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import ValueCalculator from '../components/ValueCalculator';
import { renderWithIntl, en } from './testUtils';

// TU3 (value-side, auto): a match with no odds must show a graceful no-market message and
// withhold the EV/value verdict entirely — never throw, never fabricate a value.

function mockFetchOnce(resp: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => resp })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ValueCalculator', () => {
  it('TU3: no market → no-market message, no value verdict, responsible footer still shown', async () => {
    mockFetchOnce({
      match_id: 'm1',
      market: 'h2h',
      outcome: 'home',
      market_available: false,
      pinnacle_main_point: null,
      pinnacle_novig: null,
      is_quarter_line: null,
      best_available: null,
      line_shopping: [],
      model_layer: null,
      freshness: null,
    });

    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);

    // graceful no-market message appears after the market fetch resolves
    expect(await screen.findByText(en.value.noMarketForMatch)).toBeTruthy();
    // value verdict is withheld (neither "value" nor "no value" badge rendered)
    expect(screen.queryByText(en.value.value)).toBeNull();
    expect(screen.queryByText(en.value.notValue)).toBeNull();
    // responsible-gambling footer is always present on /value (TU12)
    expect(screen.getByText(en.footer.responsibleTitle)).toBeTruthy();
  });
});
