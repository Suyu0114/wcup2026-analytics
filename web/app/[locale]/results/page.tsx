import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getFixtures } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import { siteTz } from '@/lib/format';
import type { Locale } from '@/lib/routing';
import ScoreFilters from '@/components/ScoreFilters';
import FixtureRow from '@/components/FixtureRow';
import EmptyState from '@/components/EmptyState';
import KnockoutTbd from '@/components/KnockoutTbd';

// Force-dynamic (R1): scores change on matchday via the admin → recompute pipeline; an ISR
// cache would show stale results for up to 30 min. The dataset is small (one query).
export const dynamic = 'force-dynamic';

export default async function ResultsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const { fixtures, unavailable } = await getFixtures();
  const tz = siteTz(locale);

  // Switch on stage (R4): group fixtures get the filter/date view; knockout is a separate
  // branch that renders stored knockout fixtures once they exist, else the TBD placeholder.
  const groupFixtures = fixtures.filter((f) => f.stage === 'group');
  const knockoutFixtures = fixtures.filter((f) => f.stage !== 'group');

  const teams = fixtures.flatMap((f) => [f.home, f.away]);
  const showZhBanner = locale === 'zh-TW' && teams.length > 0 && anyZhNameMissing(teams);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('results.title')}</h1>
        <p className="mt-1 text-slate-600">{t('results.subtitle')}</p>
      </header>

      {showZhBanner && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('footer.zhNamePending')}</p>
      )}

      {unavailable ? (
        <EmptyState message={t('common.dataUnavailable')} />
      ) : groupFixtures.length === 0 ? (
        <EmptyState message={t('results.empty')} />
      ) : (
        <ScoreFilters fixtures={groupFixtures} locale={locale as Locale} tz={tz} />
      )}

      {knockoutFixtures.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">{t('results.knockout')}</h2>
          {knockoutFixtures.map((f) => (
            <FixtureRow key={f.match_id} fixture={f} locale={locale as Locale} tz={tz} />
          ))}
        </section>
      ) : (
        <KnockoutTbd />
      )}
    </div>
  );
}
