import { useTranslations, useLocale } from 'next-intl';
import type { Freshness } from '@/lib/types';
import { siteTz } from '@/lib/format';

export default function FreshnessIndicator({ freshness }: { freshness: Freshness | null }) {
  const t = useTranslations();
  const locale = useLocale();
  if (!freshness || !freshness.captured_at) return null;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: siteTz(locale),
  }).format(new Date(freshness.captured_at));
  return (
    <span className={`text-xs ${freshness.stale ? 'text-amber-700' : 'text-slate-400'}`}>
      {t('common.lastUpdate')}: {when}
      {freshness.stale ? ` · ${t('common.stale')}` : ''}
    </span>
  );
}
