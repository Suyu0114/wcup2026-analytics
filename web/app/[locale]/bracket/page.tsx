import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getKnockout, getKnockoutSim, getBracketSlots } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import type { Locale } from '@/lib/routing';
import type { BracketSlotTeam } from '@/lib/types';
import BracketView from '@/components/BracketView';
import ChampionOdds from '@/components/ChampionOdds';
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
  const [{ matches }, knockoutSim, bracketSlots] = await Promise.all([
    getKnockout(v),
    getKnockoutSim(v),
    getBracketSlots(v),
  ]);

  // projected occupant lookup keyed `${match_no}-${side}` for the bracket overlay (P14)
  const projected: Record<string, BracketSlotTeam> = Object.fromEntries(
    bracketSlots.slots.map((s) => [`${s.match_no}-${s.side}`, s]),
  );

  // graceful zh-name fallback banner (spec §3.2 / §6.6)
  const teams = [
    ...matches.flatMap((m) => [m.home, m.away]),
    ...knockoutSim.teams,
  ];
  const showZhBanner = locale === 'zh-TW' && teams.length > 0 && anyZhNameMissing(teams);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('bracket.title')}</h1>
        <p className="mt-1 text-slate-600">{t('bracket.subtitle')}</p>
      </header>

      <ModelVersionSwitcher current={v} />

      {showZhBanner && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('footer.zhNamePending')}</p>
      )}

      {/* P14 champion + per-round advancement (experimental, no market — trap #7 exception) */}
      {knockoutSim.teams.length > 0 && (
        <ChampionOdds teams={knockoutSim.teams} locale={locale as Locale} />
      )}

      {/* Canonical bracket structure; R32 cells show the projected occupant when sim data exists. */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">{t('bracket.structureTitle')}</h2>
        <BracketView projected={projected} locale={locale as Locale} />
      </section>

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
