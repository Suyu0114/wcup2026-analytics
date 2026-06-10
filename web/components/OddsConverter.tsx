'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toDecimal } from '@/lib/value';
import { fromDecimal } from '@/lib/oddsFormat';
import OddsFormatSelector, { ODDS_FORMATS, type OddsFormat } from './OddsFormatSelector';

function display(v: number, fmt: string): string {
  if (fmt === 'american') return `${v > 0 ? '+' : ''}${Math.round(v)}`;
  return `${Number(v.toFixed(3))}`;
}

// Interactive widget for guide §2: type any one format, see the others + implied probability.
// Reuses value.ts toDecimal (X → decimal) and oddsFormat.ts fromDecimal (decimal → X).
export default function OddsConverter() {
  const t = useTranslations();
  const [input, setInput] = useState('2.50');
  const [fmt, setFmt] = useState<OddsFormat>('decimal');

  const num = parseFloat(input);
  let decimal: number | null = null;
  let invalid = false;
  if (input !== '' && !Number.isNaN(num)) {
    try {
      decimal = toDecimal(num, fmt);
    } catch {
      invalid = true; // graceful — never crash the island
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-sm font-medium text-slate-700">{t('guide.oddsFormats.converterTitle')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          {t('value.oddsInput')}
          <input
            type="number"
            step="any"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <OddsFormatSelector value={fmt} onChange={setFmt} />
      </div>

      {invalid && <p className="mt-2 text-sm text-rose-600">{t('value.errInvalidOdds')}</p>}

      {decimal !== null && (
        <div className="mt-3 space-y-1 text-sm">
          {ODDS_FORMATS.map((f) => (
            <div key={f} className="flex justify-between border-b border-slate-100 py-0.5">
              <span className="text-slate-500">{t(`oddsfmt.${f}`)}</span>
              <span className="font-medium tabular-nums text-slate-800">{display(fromDecimal(decimal!, f), f)}</span>
            </div>
          ))}
          <div className="flex justify-between py-0.5">
            <span className="text-slate-500">{t('guide.oddsFormats.impliedLabel')}</span>
            <span className="font-medium tabular-nums text-emerald-700">{(100 / decimal).toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
