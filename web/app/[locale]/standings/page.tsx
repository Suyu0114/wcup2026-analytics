import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getStandings } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import { siteTz, formatDateShort } from '@/lib/format';
import { Link, type Locale } from '@/lib/routing';
import StandingsTable from '@/components/StandingsTable';
import EmptyState from '@/components/EmptyState';

// Force-dynamic (R1): standings are recomputed on matchday (admin → recompute pipeline);
// ISR would mask a just-entered result for up to 30 min.
export const dynamic = 'force-dynamic';

export default async function StandingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const data = await getStandings();
  const tz = siteTz(locale);
  const groupKeys = Object.keys(data.groups).sort();

  const teams = Object.values(data.groups).flat();
  const showZhBanner = locale === 'zh-TW' && teams.length > 0 && anyZhNameMissing(teams);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('standings.title')}</h1>
        <p className="mt-1 text-slate-600">{t('standings.subtitle')}</p>
        {!data.unavailable && data.computed_at && (
          <p className="mt-1 text-xs text-slate-400">
            {t('common.asOf')} {formatDateShort(data.computed_at, locale, tz)}
          </p>
        )}
      </header>

      {showZhBanner && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('footer.zhNamePending')}</p>
      )}

      {data.unavailable ? (
        <EmptyState message={t('common.dataUnavailable')} />
      ) : groupKeys.length === 0 ? (
        <EmptyState message={t('standings.empty')} />
      ) : (
        <>
          {/* Advancement legend (R2): top-2 advance, best-3 third-placed may also advance. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-1 rounded-sm bg-emerald-500" />
              {t('standings.legendTop2')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-1 rounded-sm border-l-2 border-dashed border-emerald-300" />
              {t('standings.legendThird')}
            </span>
            <Link href="/groups" className="text-sky-700 underline-offset-2 hover:underline">
              {t('standings.legendAdvanceLink')}
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {groupKeys.map((g) => (
              <StandingsTable key={g} group={g} teams={data.groups[g]} locale={locale as Locale} />
            ))}
          </div>

          <p className="text-xs text-slate-400">{t('standings.tiebreakNote')}</p>
        </>
      )}
    </div>
  );
}
