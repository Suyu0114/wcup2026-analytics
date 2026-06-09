'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { evaluate } from '@/lib/value';
import { formatPercent, formatDecimal } from '@/lib/format';
import type { ValueMarketResponse } from '@/lib/types';
import OddsFormatSelector, { type OddsFormat } from './OddsFormatSelector';
import ExperimentalTag from './ExperimentalTag';
import ResponsibleGamblingFooter from './ResponsibleGamblingFooter';

export interface MatchOption {
  id: string;
  label: string;
}

type Market = 'h2h' | 'totals';
const OUTCOMES: Record<Market, string[]> = {
  h2h: ['home', 'draw', 'away'],
  totals: ['over', 'under'],
};

export default function ValueCalculator({ matchOptions }: { matchOptions: MatchOption[] }) {
  const t = useTranslations();
  const [matchId, setMatchId] = useState(matchOptions[0]?.id ?? '');
  const [market, setMarket] = useState<Market>('h2h');
  const [outcome, setOutcome] = useState('home');
  const [format, setFormat] = useState<OddsFormat>('decimal');
  const [oddsInput, setOddsInput] = useState('');
  const [userPoint, setUserPoint] = useState('');
  const [bankroll, setBankroll] = useState('');

  const [marketData, setMarketData] = useState<ValueMarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // fetch market side whenever match/market/outcome changes (value arithmetic stays client-side)
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

  function changeMarket(m: Market) {
    setMarket(m);
    setOutcome(OUTCOMES[m][0]);
    setUserPoint('');
  }

  const result = useMemo(() => {
    if (!marketData || !marketData.market_available || marketData.pinnacle_novig == null) return null;
    const oddsNum = parseFloat(oddsInput);
    if (oddsInput === '' || Number.isNaN(oddsNum)) return null;
    try {
      const opts =
        market === 'totals'
          ? { point: parseFloat(userPoint), pinnacleMainPoint: marketData.pinnacle_main_point ?? undefined }
          : {};
      return { ok: true as const, data: evaluate(marketData.pinnacle_novig, oddsNum, format, opts) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [marketData, oddsInput, format, market, userPoint]);

  const noMarket = marketData != null && (!marketData.market_available || marketData.pinnacle_novig == null);
  const bankrollNum = parseFloat(bankroll);

  return (
    <div className="space-y-6">
      {/* inputs */}
      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-slate-600">{t('value.selectMatch')}</span>
          <select
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            {matchOptions.length === 0 && <option value="">—</option>}
            {matchOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

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
                {t(`outcome.${o}`)}
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
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">{t('value.bankroll')}</span>
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

      {/* value result */}
      {result && !result.ok && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {t('value.errInvalidOdds')}
        </p>
      )}

      {result && result.ok && marketData && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-600">
            <span>
              {t('value.pinnacleNovig')}:{' '}
              <strong className="tabular-nums text-slate-900">
                {formatPercent(marketData.pinnacle_novig ?? 0)}
              </strong>
            </span>
            <span>
              {t('value.oddsInput')} →{' '}
              <strong className="tabular-nums text-slate-900">{formatDecimal(result.data.decimal_odds)}</strong>
            </span>
          </div>

          {result.data.line_mismatch ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{t('value.lineMismatch')}</p>
              <p className="mt-1 text-amber-800">{t('value.lineMismatchDesc')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600">{t('value.ev')}:</span>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    result.data.value ? 'text-emerald-600' : 'text-slate-700'
                  }`}
                >
                  {(result.data.ev! * 100).toFixed(2)}%
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    result.data.value ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {result.data.value ? t('value.value') : t('value.notValue')}
                </span>
                {result.data.approximate && (
                  <span
                    title={t('value.approximateDesc')}
                    className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  >
                    {t('value.approximate')}
                  </span>
                )}
              </div>

              <div className="text-sm text-slate-700">
                {t('value.kellyStake')}:{' '}
                <strong className="tabular-nums">{formatPercent(result.data.kelly_fraction ?? 0)}</strong>{' '}
                <span className="text-slate-400">({t('value.kellyDesc')})</span>
                {!Number.isNaN(bankrollNum) && bankroll !== '' && (
                  <span className="ml-2 text-slate-600">
                    ≈ {(bankrollNum * (result.data.kelly_fraction ?? 0)).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* line shopping (same line only — TV7) */}
          {marketData.line_shopping.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('value.lineShopping')}
              </p>
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

      {/* model layer — experimental, isolated from value (P3 §5.4 / TV5) */}
      {marketData?.model_layer && (
        <div className="space-y-1 rounded-lg border border-sky-100 bg-sky-50/50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              {t('value.modelLayer')}
            </span>
            <ExperimentalTag strong />
          </div>
          <p className="text-xs text-slate-500">{t('value.modelLayerDesc')}</p>
          <p className="text-sm text-slate-700">
            {t('outcome.over')} {marketData.model_layer.point}:{' '}
            <strong className="tabular-nums">{formatPercent(marketData.model_layer.p_over)}</strong>
            {' · '}
            {t('outcome.under')} {marketData.model_layer.point}:{' '}
            <strong className="tabular-nums">{formatPercent(marketData.model_layer.p_under)}</strong>
          </p>
        </div>
      )}

      <ResponsibleGamblingFooter />
    </div>
  );
}
