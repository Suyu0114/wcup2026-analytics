'use client';

import { useTranslations } from 'next-intl';

export const ODDS_FORMATS = ['decimal', 'hongkong', 'american', 'indonesian', 'malaysian'] as const;
export type OddsFormat = (typeof ODDS_FORMATS)[number];

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
