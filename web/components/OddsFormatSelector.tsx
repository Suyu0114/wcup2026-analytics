'use client';

import { useLocale, useTranslations } from 'next-intl';

export const ODDS_FORMATS = ['decimal', 'hongkong', 'american', 'indonesian', 'malaysian'] as const;
export type OddsFormat = (typeof ODDS_FORMATS)[number];

// P6 §3.6 locale defaults: decimal first everywhere (台灣運彩 = 歐洲盤);
// second slot = Hong Kong for zh-TW, American for en (Canada).
const ORDER_BY_LOCALE: Record<string, readonly OddsFormat[]> = {
  'zh-TW': ['decimal', 'hongkong', 'american', 'indonesian', 'malaysian'],
  en: ['decimal', 'american', 'hongkong', 'indonesian', 'malaysian'],
};

export default function OddsFormatSelector({
  value,
  onChange,
}: {
  value: OddsFormat;
  onChange: (f: OddsFormat) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formats = ORDER_BY_LOCALE[locale] ?? ODDS_FORMATS;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as OddsFormat)}
      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
    >
      {formats.map((f) => (
        <option key={f} value={f}>
          {t(`oddsfmt.${f}`)}
        </option>
      ))}
    </select>
  );
}
