'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  evaluate,
  evaluateModelTotals,
  evaluateModelTotalsQuarter,
} from '@/lib/value';
import { selectProb, fairProb, type ProbMode, type SelectedProb } from '@/lib/selectProb';
import { verdictTier, per100, breakeven, type VerdictTier } from '@/lib/verdict';
import { KELLY_UNLOCK_N } from '@/lib/constants';
import { formatPercent, formatDecimal } from '@/lib/format';
import type { ValueMarketResponse } from '@/lib/types';
import OddsFormatSelector, { ODDS_PLACEHOLDER, type OddsFormat } from './OddsFormatSelector';
import MatchPicker, { type MatchOption } from './MatchPicker';
import ExperimentalTag from './ExperimentalTag';
import InfoPopover from './InfoPopover';
import ResponsibleGamblingFooter from './ResponsibleGamblingFooter';

export type { MatchOption };

export interface CalculatorDefaults {
  matchId?: string;
  market?: 'h2h' | 'totals';
  outcome?: string;
}

type Market = 'h2h' | 'totals';
const OUTCOMES: Record<Market, string[]> = {
  h2h: ['home', 'draw', 'away'],
  totals: ['over', 'under'],
};

const TIER_STYLE: Record<VerdictTier, { badge: string; icon: string }> = {
  good: { badge: 'bg-emerald-100 text-emerald-800', icon: '🟢' },
  nearFair: { badge: 'bg-amber-100 text-amber-800', icon: '🟡' },
  expensive: { badge: 'bg-rose-100 text-rose-800', icon: '🔴' },
};

interface ComputedResult {
  ev: number;
  kellyFraction: number | null;
  kellyApproximate: boolean;
  marketApproximate: boolean;
  lineMismatch: boolean;
  decimalOdds: number;
}

export default function ValueCalculator({
  matchOptions,
  defaults,
}: {
  matchOptions: MatchOption[];
  defaults?: CalculatorDefaults;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const validDefault = defaults?.matchId && matchOptions.some((m) => m.id === defaults.matchId);
  const [matchId, setMatchId] = useState(validDefault ? defaults!.matchId! : (matchOptions[0]?.id ?? ''));
  const [market, setMarket] = useState<Market>(defaults?.market ?? 'h2h');
  const [outcome, setOutcome] = useState(
    defaults?.outcome && OUTCOMES[defaults?.market ?? 'h2h'].includes(defaults.outcome)
      ? defaults.outcome
      : OUTCOMES[defaults?.market ?? 'h2h'][0],
  );
  // TB1: market mode is ALWAYS the default; model mode is an explicit opt-in.
  const [mode, setMode] = useState<ProbMode>('market');
  const [format, setFormat] = useState<OddsFormat>('decimal');
  const [oddsInput, setOddsInput] = useState('');
  const [userPoint, setUserPoint] = useState('');
  const [bankroll, setBankroll] = useState('');

  const [marketData, setMarketData] = useState<ValueMarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // fetch market+model side whenever match/market/outcome changes (arithmetic stays client-side)
  useEffect(() => {
    if (!matchId) {
      setMarketData(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setFetchError(false);
    fetch(
      `/api/value/market?match_id=${encodeURIComponent(matchId)}&market=${market}&outcome=${outcome}`,
      { signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((d: ValueMarketResponse) => {
        setMarketData(d);
        if (market === 'totals' && d.pinnacle_main_point != null) {
          setUserPoint((prev) => (prev === '' ? String(d.pinnacle_main_point) : prev));
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFetchError(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [matchId, market, outcome]);

  // P6 §3.7: the divergence screener lives on THIS page, so clicking a row is a same-page
  // navigation that does NOT remount the calculator — the useState initializers above only run
  // on first mount and would leave the prefill stale. Re-apply it when the URL params change.
  // Keyed solely on the prefill primitives, so it never overrides a manual selection.
  useEffect(() => {
    if (defaults?.matchId && matchOptions.some((m) => m.id === defaults.matchId)) {
      setMatchId(defaults.matchId);
    }
    const m: Market = defaults?.market === 'totals' ? 'totals' : 'h2h';
    setMarket(m);
    setOutcome(defaults?.outcome && OUTCOMES[m].includes(defaults.outcome) ? defaults.outcome : OUTCOMES[m][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults?.matchId, defaults?.market, defaults?.outcome]);

  function changeMarket(m: Market) {
    setMarket(m);
    setOutcome(OUTCOMES[m][0]);
    setUserPoint('');
  }

  const pointNum = userPoint === '' ? null : parseFloat(userPoint);

  // P6 §3.1 / TB8: the ONLY probability selection point — the rendered source label
  // and the p fed into evaluate() come from this same object.
  const selected: SelectedProb | null = useMemo(() => {
    if (!marketData) return null;
    return selectProb(mode, marketData, market === 'totals' ? pointNum : null);
  }, [marketData, mode, market, pointNum]);

  const result = useMemo((): { ok: true; data: ComputedResult } | { ok: false; error: string } | null => {
    if (!marketData || !selected || selected.kind === 'unavailable') return null;
    const oddsNum = parseFloat(oddsInput);
    if (oddsInput === '' || Number.isNaN(oddsNum)) return null;
    try {
      if (selected.kind === 'binary') {
        const opts =
          selected.source === 'market' && market === 'totals'
            ? { point: pointNum, pinnacleMainPoint: marketData.pinnacle_main_point ?? undefined }
            : {};
        const r = evaluate(selected.p, oddsNum, format, opts);
        return {
          ok: true,
          data: {
            ev: r.ev ?? NaN,
            kellyFraction: r.kelly_fraction,
            kellyApproximate: false,
            marketApproximate: Boolean(r.approximate),
            lineMismatch: r.line_mismatch,
            decimalOdds: r.decimal_odds,
          },
        };
      }
      const r =
        selected.kind === 'push'
          ? evaluateModelTotals(selected.pWin, selected.pPush, oddsNum, format)
          : evaluateModelTotalsQuarter(selected.lo, selected.hi, oddsNum, format);
      return {
        ok: true,
        data: {
          ev: r.ev,
          kellyFraction: r.kelly_fraction,
          kellyApproximate: r.kelly_approximate,
          marketApproximate: false,
          lineMismatch: false,
          decimalOdds: r.decimal_odds,
        },
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [marketData, selected, oddsInput, format, market, pointNum]);

  const noMarket = marketData != null && (!marketData.market_available || marketData.pinnacle_novig == null);
  const bankrollNum = parseFloat(bankroll);
  const calibration = marketData?.calibration ?? null;
  const kellyUnlocked = mode === 'market' || Boolean(calibration?.kelly_unlocked);
  const isModel = mode === 'model';
  const fair = selected ? fairProb(selected) : null;
  const currency = locale === 'zh-TW' ? 'TWD' : 'CAD';

  // outcome dropdown shows WHICH team is home/away so users don't have to guess (req #2.2);
  // falls back to the plain outcome label when team names aren't supplied.
  const currentOption = matchOptions.find((m) => m.id === matchId) ?? null;
  function outcomeLabel(o: string): string {
    if (o === 'home' && currentOption?.home) return `${t('outcome.home')}（${currentOption.home.name}）`;
    if (o === 'away' && currentOption?.away) return `${t('outcome.away')}（${currentOption.away.name}）`;
    return t(`outcome.${o}`);
  }

  return (
    <div className="space-y-6">
      {/* mode switch (TB1: market default; model = explicit, experimental) */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('value.mode')}>
        <span className="text-sm text-slate-600">{t('value.mode')}:</span>
        <button
          type="button"
          onClick={() => setMode('market')}
          aria-pressed={mode === 'market'}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            mode === 'market' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {t('value.modeMarket')}
        </button>
        <button
          type="button"
          onClick={() => setMode('model')}
          aria-pressed={mode === 'model'}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            mode === 'model' ? 'bg-sky-700 text-white' : 'bg-sky-50 text-sky-700'
          }`}
        >
          {t('value.modeModel')}
        </button>
        {isModel && <ExperimentalTag strong />}
      </div>

      {/* inputs */}
      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-slate-600">{t('value.selectMatch')}</span>
          <MatchPicker options={matchOptions} value={matchId} onChange={setMatchId} />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">{t('value.selectMarket')}</span>
          <select
            value={market}
            onChange={(e) => changeMarket(e.target.value as Market)}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="h2h">{t('market.h2h')}</option>
            <option value="totals">{t('market.totals')}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">{t('value.selectOutcome')}</span>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            {OUTCOMES[market].map((o) => (
              <option key={o} value={o}>
                {outcomeLabel(o)}
              </option>
            ))}
          </select>
        </label>

        {market === 'totals' && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">
              {t('value.yourLine')}
              {marketData?.pinnacle_main_point != null && (
                <span className="ml-1 text-slate-400">
                  ({t('value.mainLine')}: {marketData.pinnacle_main_point})
                </span>
              )}
            </span>
            <input
              type="number"
              step="0.25"
              value={userPoint}
              onChange={(e) => setUserPoint(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1.5"
            />
            <span className="text-xs leading-relaxed text-slate-400">
              {t('value.yourLineHint')}
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">{t('value.oddsFormat')}</span>
          <OddsFormatSelector value={format} onChange={setFormat} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">{t('value.oddsInput')}</span>
          <input
            type="number"
            step="any"
            value={oddsInput}
            onChange={(e) => setOddsInput(e.target.value)}
            placeholder={ODDS_PLACEHOLDER[format]}
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1 text-slate-600">
            {t('value.bankroll', { currency })}
            <InfoPopover title={t('value.bankroll', { currency })} body={t('value.bankrollHelp')} align="end" />
          </span>
          <input
            type="number"
            step="any"
            value={bankroll}
            onChange={(e) => setBankroll(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>

      {/* states */}
      {loading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {fetchError && <p className="text-sm text-rose-600">{t('common.dataUnavailable')}</p>}
      {noMarket && !loading && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {t('value.noMarketForMatch')}
        </p>
      )}
      {!noMarket && selected?.kind === 'unavailable' && selected.reason === 'line-out-of-range' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t('value.lineOutOfRange')}
        </p>
      )}
      {!noMarket && selected?.kind === 'unavailable' && selected.reason === 'no-model' && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {t('value.noModelForMatch')}
        </p>
      )}

      {/* invalid odds */}
      {result && !result.ok && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {t('value.errInvalidOdds')}
        </p>
      )}

      {/* result card — styling and labels keyed to the SAME selected.source (TB8d) */}
      {result && result.ok && marketData && selected && selected.kind !== 'unavailable' && (
        <div
          className={`space-y-3 rounded-lg border p-4 ${
            isModel ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-semibold">
              {selected.source === 'model' ? t('value.calcByModel') : t('value.calcByMarket')}
            </span>
            {selected.source === 'model' && <ExperimentalTag strong />}
          </div>

          {/* model mode: calibration status line — always shown (P6 §3.1) */}
          {isModel && (
            <p className="text-xs text-sky-900">
              {calibration && calibration.n_settled > 0 && calibration.model_brier != null && calibration.market_brier != null
                ? t('value.calibrationStatus', {
                    n: calibration.n_settled,
                    mb: calibration.model_brier.toFixed(3),
                    kb: calibration.market_brier.toFixed(3),
                  })
                : t('value.calibrationNone')}
            </p>
          )}

          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-600">
            <span>
              {selected.source === 'model' ? t('value.modelFairProb') : t('value.pinnacleNovig')}:{' '}
              <strong className="tabular-nums text-slate-900">{fair != null ? formatPercent(fair) : '—'}</strong>
            </span>
            <span>
              {t('value.oddsInput')} →{' '}
              <strong className="tabular-nums text-slate-900">{formatDecimal(result.data.decimalOdds)}</strong>
            </span>
          </div>

          {/* model mode: market reference row — never hidden (P6 §3.1 / TB2) */}
          {isModel && marketData.pinnacle_novig != null && (
            <p className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              {market === 'totals' &&
              marketData.pinnacle_main_point != null &&
              pointNum != null &&
              pointNum !== marketData.pinnacle_main_point
                ? t('value.marketRefMainLine', { point: marketData.pinnacle_main_point })
                : t('value.marketRef')}
              : <strong className="tabular-nums">{formatPercent(marketData.pinnacle_novig)}</strong>
            </p>
          )}

          {result.data.lineMismatch ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{t('value.lineMismatch')}</p>
              <p className="mt-1 text-amber-800">{t('value.lineMismatchDesc')}</p>
            </div>
          ) : (
            <VerdictBlock
              ev={result.data.ev}
              decimalOdds={result.data.decimalOdds}
              fair={fair}
              source={selected.source}
              marketApproximate={result.data.marketApproximate}
            />
          )}

          {/* Kelly: market mode always; model mode behind the calibration gate (P6 §3.5 / TB5) */}
          {!result.data.lineMismatch &&
            (kellyUnlocked ? (
              <div className="text-sm text-slate-700">
                {t('value.kellyStake')}:{' '}
                <strong className="tabular-nums">{formatPercent(result.data.kellyFraction ?? 0)}</strong>{' '}
                <span className="text-slate-400">({t('value.kellyDesc')})</span>
                {result.data.kellyApproximate && (
                  <span
                    title={t('value.approximateDesc')}
                    className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  >
                    {t('value.kellyApprox')}
                  </span>
                )}
                {!Number.isNaN(bankrollNum) && bankroll !== '' && (
                  <span className="ml-2 text-slate-600">
                    ≈ {(bankrollNum * (result.data.kellyFraction ?? 0)).toFixed(2)} {currency}
                  </span>
                )}
              </div>
            ) : (
              <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                {calibration && calibration.n_settled >= KELLY_UNLOCK_N
                  ? t('value.kellyLockedFailed')
                  : t('value.kellyLockedProgress', {
                      n: calibration?.n_settled ?? 0,
                      total: KELLY_UNLOCK_N,
                    })}
              </p>
            ))}

          {/* line shopping (same line only — TV7); market data regardless of mode */}
          {marketData.line_shopping.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('value.lineShopping')}
              </p>
              {result.ok &&
                marketData.best_available &&
                (marketData.best_available.decimal > result.data.decimalOdds + 1e-9 ? (
                  <p className="mb-2 text-sm text-emerald-700">
                    {t('value.betterPriceAt', {
                      book: marketData.best_available.book,
                      price: formatDecimal(marketData.best_available.decimal),
                      yours: formatDecimal(result.data.decimalOdds),
                    })}
                  </p>
                ) : (
                  <p className="mb-2 text-sm text-slate-600">{t('value.yourPriceIsBest')}</p>
                ))}
              <ul className="flex flex-wrap gap-2 text-sm">
                {marketData.line_shopping.map((b, i) => (
                  <li
                    key={b.book}
                    className={`rounded px-2 py-1 ${i === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`}
                  >
                    {b.book}: <span className="tabular-nums">{formatDecimal(b.decimal)}</span>
                    {i === 0 && <span className="ml-1 text-xs">★ {t('value.bestAvailable')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ResponsibleGamblingFooter />
    </div>
  );
}

function VerdictBlock({
  ev,
  decimalOdds,
  fair,
  source,
  marketApproximate,
}: {
  ev: number;
  decimalOdds: number;
  fair: number | null;
  source: ProbMode;
  marketApproximate: boolean;
}) {
  const t = useTranslations();
  const tier = verdictTier(ev);
  const style = TIER_STYLE[tier];
  const amount = per100(ev);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">{t('value.ev')}:</span>
        <span className={`text-lg font-bold tabular-nums ${tier === 'good' ? 'text-emerald-600' : 'text-slate-700'}`}>
          {(ev * 100).toFixed(2)}%
        </span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${style.badge}`}>
          {style.icon} {t(`value.tier_${tier}`)}
        </span>
        {marketApproximate && (
          <span
            title={t('value.approximateDesc')}
            className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
          >
            {t('value.approximate')}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-700">
        {amount >= 0
          ? t('value.per100Win', { amount: amount.toFixed(1) })
          : t('value.per100Lose', { amount: Math.abs(amount).toFixed(1) })}
      </p>
      {fair != null && (
        <p className="text-sm text-slate-700">
          {t(source === 'model' ? 'value.breakevenModel' : 'value.breakevenMarket', {
            be: formatPercent(breakeven(decimalOdds)),
            fair: formatPercent(fair),
          })}
        </p>
      )}
      {tier === 'nearFair' && <p className="text-xs text-slate-500">{t('value.nearFairNote')}</p>}
    </div>
  );
}
