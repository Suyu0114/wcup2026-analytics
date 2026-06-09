import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMatches } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import { siteTz } from '@/lib/format';
import type { Locale } from '@/lib/routing';
import MatchCard from '@/components/MatchCard';
import EmptyState from '@/components/EmptyState';

export const revalidate = 1800; // time-based ISR (spec §2 / Issue 2)

export default async function MatchesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const { matches, unavailable } = await getMatches();
  const tz = siteTz();

  // graceful zh-name fallback banner (spec §3.2 / §6.6)
  const teams = matches.flatMap((m) => [m.home, m.away]);
  const showZhBanner = locale === 'zh-TW' && teams.length > 0 && anyZhNameMissing(teams);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('matches.title')}</h1>
        <p className="mt-1 text-slate-600">{t('matches.subtitle')}</p>
      </header>

      {showZhBanner && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('footer.zhNamePending')}</p>
      )}

      {unavailable ? (
        <EmptyState message={t('common.dataUnavailable')} />
      ) : matches.length === 0 ? (
        <EmptyState message={t('matches.predictionsEmpty')} />
      ) : (
        <div className="space-y-4">
          {matches.map((m) => (
            <MatchCard key={m.match_id} match={m} locale={locale as Locale} tz={tz} />
          ))}
        </div>
      )}

      {/* Knockout TBD placeholder (trap #10 / §6.4 / TU4) — graceful, no fabricated matchups */}
      <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <h2 className="text-sm font-semibold text-slate-700">{t('matches.knockoutTbd')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('matches.knockoutTbdDesc')}</p>
      </section>
    </div>
  );
}
