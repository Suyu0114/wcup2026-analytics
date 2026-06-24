import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getKnockout } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import type { Locale } from '@/lib/routing';
import BracketView from '@/components/BracketView';
import KnockoutMatchCard from '@/components/KnockoutMatchCard';
import ModelVersionSwitcher from '@/components/ModelVersionSwitcher';

// Force-dynamic (?v model version, P10) + matchday freshness, same as /matches & /results.
export const dynamic = 'force-dynamic';

export default async function BracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { locale } = await params;
  const { v } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const { matches } = await getKnockout(v);

  // graceful zh-name fallback banner (spec §3.2 / §6.6)
  const teams = matches.flatMap((m) => [m.home, m.away]);
  const showZhBanner = locale === 'zh-TW' && teams.length > 0 && anyZhNameMissing(teams);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('bracket.title')}</h1>
        <p className="mt-1 text-slate-600">{t('bracket.subtitle')}</p>
      </header>

      <ModelVersionSwitcher current={v} />

      {showZhBanner && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('footer.zhNamePending')}</p>
      )}

      {/* Canonical bracket structure — always shown (slot template); teams fill in post-draw. */}
      <BracketView />

      {matches.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('bracket.predictionsTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('bracket.predictionsNote')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {matches.map((m) => (
              <KnockoutMatchCard key={m.match_id} match={m} locale={locale as Locale} />
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
          {t('bracket.preDrawNote')}
        </p>
      )}
    </div>
  );
}
