import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getScenarios, getStandings, getGroups } from '@/lib/data';
import { anyZhNameMissing } from '@/lib/teamName';
import { siteTz, formatDateShort } from '@/lib/format';
import { type Locale } from '@/lib/routing';
import StandingsTable from '@/components/StandingsTable';
import ScenarioCard from '@/components/ScenarioCard';
import ModelVersionSwitcher from '@/components/ModelVersionSwitcher';
import EmptyState from '@/components/EmptyState';

// Force-dynamic: scenarios are recomputed on matchday (admin → recompute pipeline); ISR
// would mask a just-entered result. Reading ?v (probability overlay version) also opts in.
export const dynamic = 'force-dynamic';

export default async function ScenariosPage({
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
  const tz = siteTz(locale);

  const [data, standings, groupsData] = await Promise.all([
    getScenarios(),
    getStandings(),
    getGroups(v), // probability overlay only (separate from the facts; spec §7)
  ]);

  // team_id → P(advance) from the (separate, experimental) model simulation.
  const probByTeam = groupsData.unavailable
    ? undefined
    : new Map(
        Object.values(groupsData.groups)
          .flat()
          .map((g) => [g.team_id, g.p_advance] as const),
      );

  const groupKeys = Object.keys(data.groups).sort();
  const allTeams = Object.values(standings.groups).flat();
  const showZhBanner = locale === 'zh-TW' && allTeams.length > 0 && anyZhNameMissing(allTeams);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('scenarios.title')}</h1>
        <p className="mt-1 text-slate-600">{t('scenarios.subtitle')}</p>
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
        <EmptyState message={t('scenarios.empty')} />
      ) : (
        <>
          {/* Status legend (facts) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-emerald-200 bg-emerald-50" />
              {t('scenarios.legendClinched')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-amber-200 bg-amber-50" />
              {t('scenarios.legendAlive')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-rose-200 bg-rose-50" />
              {t('scenarios.legendEliminated')}
            </span>
          </div>

          {/* The ?v switcher only re-points the experimental probability overlay. */}
          {probByTeam && <ModelVersionSwitcher current={v} />}

          <div className="space-y-8">
            {groupKeys.map((g) => (
              <section key={g} className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-800">
                  {t('groups.groupLabel')} {g}
                </h2>
                {standings.groups[g] && (
                  <StandingsTable group={g} teams={standings.groups[g]} locale={locale as Locale} />
                )}
                <div className="space-y-3">
                  {data.groups[g].map((s) => (
                    <ScenarioCard
                      key={s.match_id}
                      scenario={s}
                      locale={locale as Locale}
                      probByTeam={probByTeam}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="text-xs text-slate-400">{t('scenarios.factNote')}</p>
          {probByTeam && <p className="text-xs text-slate-400">{t('scenarios.probNote')}</p>}
        </>
      )}
    </div>
  );
}
