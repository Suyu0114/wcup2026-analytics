import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getTrackRecord } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import type { Locale } from '@/lib/routing';
import type { TrackRecordSummary } from '@/lib/types';
import EmptyState from '@/components/EmptyState';
import TrackRecordRow from '@/components/TrackRecordRow';
import UpsetAudit from '@/components/UpsetAudit';

// Force-dynamic (R1, as /results): predictions are frozen but results land on matchday via the
// admin → recompute pipeline; an ISR cache would show stale accuracy. Small dataset (3 queries).
export const dynamic = 'force-dynamic';

function StatCard({
  label,
  side,
  tone,
  accuracyLabel,
  brierLabel,
  emptyLabel,
}: {
  label: string;
  side: TrackRecordSummary['model'];
  tone: 'model' | 'market';
  accuracyLabel: string;
  brierLabel: string;
  emptyLabel: string;
}) {
  const ring = tone === 'model' ? 'border-sky-200 bg-sky-50/50' : 'border-emerald-200 bg-emerald-50/50';
  const accent = tone === 'model' ? 'text-sky-800' : 'text-emerald-800';
  return (
    <div className={`flex-1 rounded-lg border p-3 ${ring}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${accent}`}>{label}</div>
      {side ? (
        <div className="mt-1 space-y-0.5">
          <div className="text-sm text-slate-700">
            {accuracyLabel}:{' '}
            <span className="font-bold tabular-nums text-slate-900">
              {side.correct}/{side.n}
            </span>{' '}
            <span className="tabular-nums text-slate-500">({formatPercent(side.correct / side.n, 0)})</span>
          </div>
          <div className="text-sm text-slate-700">
            {brierLabel}: <span className="font-bold tabular-nums text-slate-900">{side.brier.toFixed(3)}</span>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm text-slate-400">{emptyLabel}</p>
      )}
    </div>
  );
}

export default async function TrackRecordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const { rows, summary, unavailable } = await getTrackRecord();

  const teams = rows.flatMap((r) => [r.home, r.away]);
  const showZhBanner = locale === 'zh-TW' && teams.length > 0 && anyZhNameMissing(teams);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('trackRecord.title')}</h1>
        <p className="mt-1 text-slate-600">{t('trackRecord.subtitle')}</p>
      </header>

      {showZhBanner && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('footer.zhNamePending')}</p>
      )}

      {unavailable ? (
        <EmptyState message={t('common.dataUnavailable')} />
      ) : rows.length === 0 ? (
        <EmptyState message={t('trackRecord.empty')} />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-bold text-slate-900">{t('trackRecord.scorecardTitle')}</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <StatCard
                label={t('trackRecord.model')}
                side={summary.model}
                tone="model"
                accuracyLabel={t('trackRecord.accuracy')}
                brierLabel={t('trackRecord.brier')}
                emptyLabel={t('trackRecord.empty')}
              />
              <StatCard
                label={t('trackRecord.market')}
                side={summary.market}
                tone="market"
                accuracyLabel={t('trackRecord.accuracy')}
                brierLabel={t('trackRecord.brier')}
                emptyLabel={t('trackRecord.noMarketBench')}
              />
            </div>
            <p className="text-xs text-slate-400">{t('trackRecord.scorecardNote')}</p>
          </section>

          <UpsetAudit rows={rows} summary={summary.upset} locale={locale as Locale} />

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-slate-900">{t('trackRecord.listTitle')}</h2>
            <div className="space-y-2">
              {rows.map((r) => (
                <TrackRecordRow key={r.match_id} row={r} locale={locale as Locale} />
              ))}
            </div>
          </section>

          <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">{t('trackRecord.frozenNote')}</p>
        </>
      )}
    </div>
  );
}
