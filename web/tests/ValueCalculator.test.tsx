// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ValueCalculator, { type MatchOption } from '../components/ValueCalculator';
import { renderWithIntl, en } from './testUtils';
import type { ValueMarketResponse } from '../lib/types';

// P6 Workstream B component acceptance:
//   TB1 default mode = market;   TB2 model mode shows market reference + experimental tag
//   TB3 no market -> no EV in EITHER mode;   TB5 Kelly gate (two distinct lock messages)
//   TB8c distinguishable-fixture numeric assertion (market 0.40 vs model 0.70 — any
//   blending of the two sources would render a different EV number and fail).

function h2hResp(over: Partial<ValueMarketResponse> = {}): ValueMarketResponse {
  return {
    match_id: 'm1',
    market: 'h2h',
    outcome: 'home',
    market_available: true,
    pinnacle_main_point: null,
    pinnacle_novig: 0.4,
    is_quarter_line: null,
    best_available: { book: 'pinnacle', decimal: 2.4 },
    line_shopping: [{ book: 'pinnacle', decimal: 2.4 }],
    model_h2h: { model_version: 'dc-v1.1', p_home: 0.7, p_draw: 0.2, p_away: 0.1 },
    model_totals_grid: null,
    calibration: null,
    freshness: null,
    ...over,
  };
}

function mockFetchOnce(resp: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => resp })),
  );
}

function setOdds(value: string) {
  fireEvent.change(screen.getByLabelText(en.value.oddsInput), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ValueCalculator v2', () => {
  it('TB1: market mode is the default; model mode needs an explicit switch', async () => {
    mockFetchOnce(h2hResp());
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    const marketBtn = await screen.findByRole('button', { name: en.value.modeMarket });
    const modelBtn = screen.getByRole('button', { name: en.value.modeModel });
    expect(marketBtn.getAttribute('aria-pressed')).toBe('true');
    expect(modelBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('outcome dropdown shows which team is home/away when names are provided', async () => {
    mockFetchOnce(h2hResp());
    renderWithIntl(
      <ValueCalculator
        matchOptions={[
          {
            id: 'm1',
            label: 'Mexico vs South Africa',
            home: { teamId: 'MX', name: 'Mexico' },
            away: { teamId: 'ZA', name: 'South Africa' },
            group: 'A',
          },
        ]}
      />,
    );
    await screen.findByRole('button', { name: en.value.modeModel });
    expect(screen.getByText('Home（Mexico）')).toBeTruthy();
    expect(screen.getByText('Away（South Africa）')).toBeTruthy();
  });

  it('re-applies the screener prefill when defaults change (same-page nav, no remount)', async () => {
    mockFetchOnce(h2hResp());
    const opts: MatchOption[] = [
      { id: 'm1', label: 'A vs B', home: { teamId: 'A', name: 'Argentina' }, away: { teamId: 'B', name: 'Brazil' }, group: 'A' },
      { id: 'm2', label: 'C vs D', home: { teamId: 'C', name: 'Chile' }, away: { teamId: 'D', name: 'Denmark' }, group: 'B' },
    ];
    const wrap = (defaults: { matchId: string; market: 'h2h'; outcome: string }) => (
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={en as never}>
        <ValueCalculator matchOptions={opts} defaults={defaults} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(wrap({ matchId: 'm1', market: 'h2h', outcome: 'home' }));
    await screen.findByRole('button', { name: en.value.modeModel });
    expect((screen.getByLabelText(en.value.selectOutcome) as HTMLSelectElement).value).toBe('home');
    expect(screen.getByRole('button', { name: /Argentina/ })).toBeTruthy();
    // clicking a divergence row = same-page navigation: a new defaults prop, NO remount
    rerender(wrap({ matchId: 'm2', market: 'h2h', outcome: 'away' }));
    await screen.findByRole('button', { name: /Chile/ });
    expect((screen.getByLabelText(en.value.selectOutcome) as HTMLSelectElement).value).toBe('away');
  });

  it('TB8c: per-mode EV equals evaluate() on that mode probability exactly', async () => {
    mockFetchOnce(h2hResp());
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    await screen.findByRole('button', { name: en.value.modeModel });
    setOdds('2.0');
    // market mode: EV = 0.40*2.0 - 1 = -20.00%  (label keyed to the same selection)
    expect(await screen.findByText('-20.00%')).toBeTruthy();
    expect(screen.getByText(en.value.calcByMarket)).toBeTruthy();
    expect(screen.queryByText('40.00%')).toBeNull();
    // switch to model mode: EV = 0.70*2.0 - 1 = +40.00% — any mixing would mismatch
    fireEvent.click(screen.getByRole('button', { name: en.value.modeModel }));
    expect(await screen.findByText('40.00%')).toBeTruthy();
    expect(screen.queryByText('-20.00%')).toBeNull();
    expect(screen.getByText(en.value.calcByModel)).toBeTruthy();
  });

  it('TB2: model mode shows the market reference row + calibration status', async () => {
    mockFetchOnce(h2hResp());
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    await screen.findByRole('button', { name: en.value.modeModel });
    setOdds('2.0');
    fireEvent.click(screen.getByRole('button', { name: en.value.modeModel }));
    await screen.findByText('40.00%');
    const refRows = screen.getAllByText(
      (_, el) => el?.tagName === 'P' && (el.textContent?.includes(en.value.marketRef) ?? false),
    );
    expect(refRows.length).toBeGreaterThan(0);                               // never hidden
    expect(screen.getByText(en.value.calibrationNone)).toBeTruthy();         // honest status
  });

  it('TB3: no market -> no EV in either mode, footer still shown', async () => {
    mockFetchOnce(h2hResp({ market_available: false, pinnacle_novig: null, line_shopping: [], best_available: null }));
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    expect(await screen.findByText(en.value.noMarketForMatch)).toBeTruthy();
    setOdds('2.0');
    expect(screen.queryByText(/%$/)).toBeNull();
    // model mode must NOT resurrect an EV without a market reference (P6 §1.6)
    fireEvent.click(screen.getByRole('button', { name: en.value.modeModel }));
    expect(screen.getByText(en.value.noMarketForMatch)).toBeTruthy();
    expect(screen.queryByText('40.00%')).toBeNull();
    expect(screen.getByText(en.footer.responsibleTitle)).toBeTruthy();
  });

  it('TB5: Kelly locked with progress when calibration missing/n<30; market mode unaffected', async () => {
    mockFetchOnce(h2hResp());                              // calibration: null
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    await screen.findByRole('button', { name: en.value.modeModel });
    setOdds('2.4');                                        // market EV = 0.4*2.4-1 = -4% -> kelly 0 but shown
    expect(await screen.findByText(new RegExp(en.value.kellyDesc))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.value.modeModel }));
    expect(await screen.findByText((c) => c.includes('0/30'))).toBeTruthy();  // progress numbers render
    expect(screen.queryByText(new RegExp(en.value.kellyDesc))).toBeNull();    // no stake suggestion
  });

  it('TB5: Kelly locked with the "below the bar" message when n>=30 but Brier fails', async () => {
    mockFetchOnce(
      h2hResp({
        calibration: {
          model_version: 'dc-v1.1', run_at: 'x', n_settled: 40,
          model_brier: 0.7, market_brier: 0.55, kelly_unlocked: false,
        },
      }),
    );
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    await screen.findByRole('button', { name: en.value.modeModel });
    setOdds('2.0');
    fireEvent.click(screen.getByRole('button', { name: en.value.modeModel }));
    expect(await screen.findByText(en.value.kellyLockedFailed)).toBeTruthy();
    expect(screen.queryByText((c) => c.includes('0/30'))).toBeNull();   // distinct from progress
  });

  it('TB5: Kelly unlocked when the server says so', async () => {
    mockFetchOnce(
      h2hResp({
        calibration: {
          model_version: 'dc-v1.1', run_at: 'x', n_settled: 40,
          model_brier: 0.55, market_brier: 0.55, kelly_unlocked: true,
        },
      }),
    );
    renderWithIntl(<ValueCalculator matchOptions={[{ id: 'm1', label: 'A vs B' }]} />);
    await screen.findByRole('button', { name: en.value.modeModel });
    setOdds('2.0');
    fireEvent.click(screen.getByRole('button', { name: en.value.modeModel }));
    await screen.findByText('40.00%');
    expect(screen.getByText(new RegExp(en.value.kellyDesc))).toBeTruthy();
  });
});
