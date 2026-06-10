import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import type { DivergenceRow } from '@/lib/divergence';
import type { Locale } from '@/lib/routing';
import ExperimentalTag from './ExperimentalTag';

// P6 §3.7 / TB10: model-vs-market divergence screener — an entry point into the
// calculator, NOT a value list (disclaimer always shown; model + market side by side).
export default function DivergenceList({ rows, locale }: { rows: DivergenceRow[]; locale: Locale }) {
  const t = useTranslations();
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-sky-900">{t('value.divergenceTitle')}</h2>
        <ExperimentalTag strong />
      </div>
      <p className="text-xs text-slate-500">{t('value.divergenceDisclaimer')}</p>
      <ul className="divide-y divide-sky-100">
        {rows.map((r) => (
          <li key={r.match_id}>
            <Link
              href={`/${locale}/value?match=${encodeURIComponent(r.match_id)}&market=h2h&outcome=${r.outcome}`}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm hover:bg-sky-50"
            >
              <span className="text-slate-800">
                {displayTeamName(r.home, locale)} vs {displayTeamName(r.away, locale)}
                <span className="ml-2 text-xs text-slate-500">{t(`outcome.${r.outcome}`)}</span>
              </span>
              <span className="tabular-nums text-slate-600">
                {t('value.divergenceModel')} {formatPercent(r.model_p)} ·{' '}
                {t('value.divergenceMarket')} {formatPercent(r.market_p)} ·{' '}
                <strong className={r.diff > 0 ? 'text-sky-700' : 'text-slate-700'}>
                  {t('value.divergenceDiff')} {(r.diff * 100).toFixed(1)}pp
                </strong>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
