import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, type Locale } from '@/lib/routing';
import Disclaimer from '@/components/Disclaimer';
import FeaturedMatchCard from '@/components/FeaturedMatchCard';
import { getFreshnessSummary, getMatches } from '@/lib/data';
import { getManualResults } from '@/lib/adminServer';
import { selectFeatured, isKickoffToday } from '@/lib/featured';
import { formatDateShort, siteTz } from '@/lib/format';

// Featured cards must advance the moment a result is entered (manual_results) —
// force-dynamic like /results and /standings (P8), no 30-min ISR lag.
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const [{ matches }, manualResults, fresh] = await Promise.all([
    getMatches(),
    getManualResults(),
    getFreshnessSummary(),
  ]);
  const tz = siteTz(locale);
  const featured = selectFeatured(matches, manualResults);

  const cards = [
    { href: '/matches' as const, title: t('home.cardMatchesTitle'), desc: t('home.cardMatchesDesc') },
    { href: '/groups' as const, title: t('home.cardGroupsTitle'), desc: t('home.cardGroupsDesc') },
    { href: '/value' as const, title: t('home.cardValueTitle'), desc: t('home.cardValueDesc') },
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold text-slate-900">{t('home.heroTitle')}</h1>
        <p className="text-slate-600">{t('home.heroSubtitle')}</p>
        <Disclaimer />
      </section>

      {featured.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('featured.heading')}
          </h2>
          <div className="grid items-stretch gap-4 lg:grid-cols-3">
            {featured.map((m) => (
              <FeaturedMatchCard
                key={m.match_id}
                match={m}
                locale={locale as Locale}
                tz={tz}
                isToday={isKickoffToday(m.kickoff_utc, tz)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-lg border border-slate-200 bg-white p-5 transition hover:border-sky-300 hover:shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-900">{c.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{c.desc}</p>
          </Link>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('home.freshnessHeading')}
        </h2>
        <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">{t('common.eloAsof')}</dt>
            <dd className="font-medium tabular-nums">{formatDateShort(fresh.elo_asof, locale, tz)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('common.lastUpdate')}</dt>
            <dd className="font-medium tabular-nums">{formatDateShort(fresh.odds_captured_at, locale, tz)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('common.simN')}</dt>
            <dd className="font-medium tabular-nums">{formatDateShort(fresh.sim_computed_at, locale, tz)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
