'use client';

import { useTranslations } from 'next-intl';

// Decimal (台灣運彩 = 歐洲盤) first, then American/Moneyline — the only two formats most users
// reach for; Hong Kong / Indonesian / Malaysian trail as rarely-used options (same order in
// both locales, UX overhaul req #2.4).
export const ODDS_FORMATS = ['decimal', 'american', 'hongkong', 'indonesian', 'malaysian'] as const;
export type OddsFormat = (typeof ODDS_FORMATS)[number];

// Gray placeholder hint shown in the odds input — all encode the same ~1.50 decimal price so
// users see a concrete, format-appropriate example. Hint only; never fed into the EV math.
export const ODDS_PLACEHOLDER: Record<OddsFormat, string> = {
  decimal: '1.50',
  american: '-200',
  hongkong: '0.50',
  indonesian: '-2.00',
  malaysian: '0.50',
};

export default function OddsFormatSelector({
  value,
  onChange,
}: {
  value: OddsFormat;
  onChange: (f: OddsFormat) => void;
}) {
  const t = useTranslations();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as OddsFormat)}
      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
    >
      {ODDS_FORMATS.map((f) => (
        <option key={f} value={f}>
          {t(`oddsfmt.${f}`)}
        </option>
      ))}
    </select>
  );
}
