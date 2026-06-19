import { useTranslations } from 'next-intl';
import type { MatchScenarioView, TeamOutcomeView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import Flag from './Flag';

// One pending group match (P11): three columns (home win / draw / away win); each cell shows
// what that result does to BOTH teams' qualification status. Status badges are deterministic
// FACTS; the model probability (sky, "experimental") is overlaid SEPARATELY on `alive` teams
// and must never read like a clinch (spec §7 guardrail).

const STATUS_STYLE: Record<string, string> = {
  top2_clinched: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  advance_clinched: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  eliminated: 'bg-rose-50 text-rose-700 border-rose-200',
  alive: 'bg-amber-50 text-amber-700 border-amber-200',
};

function OutcomeBadge({
  outcome,
  locale,
  prob,
  t,
}: {
  outcome: TeamOutcomeView;
  locale: Locale;
  prob: number | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  const style = STATUS_STYLE[outcome.status] ?? STATUS_STYLE.alive;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs">
        <Flag teamId={outcome.team_id} />
        <span className="truncate text-slate-600">{displayTeamName(outcome, locale)}</span>
      </span>
      <span className={`ml-5 inline-block w-fit rounded border px-1.5 py-0.5 text-[11px] font-medium ${style}`}>
        {t(`scenarios.basis_${outcome.basis_key}`)}
      </span>
      {outcome.seeding_live && (
        <span className="ml-5 text-[10px] text-slate-500">{t('scenarios.seedingLive')}</span>
      )}
      {outcome.status === 'alive' && prob != null && (
        <span className="ml-5 text-[10px] text-sky-600">
          {t('scenarios.probAdvance', { pct: formatPercent(prob) })}
        </span>
      )}
    </div>
  );
}

export default function ScenarioCard({
  scenario,
  locale,
  probByTeam,
}: {
  scenario: MatchScenarioView;
  locale: Locale;
  probByTeam?: Map<string, number>;
}) {
  const t = useTranslations();
  const homeName = displayTeamName(scenario.home, locale);
  const awayName = displayTeamName(scenario.away, locale);
  const columns: Array<['home' | 'draw' | 'away', string]> = [
    ['home', t('scenarios.teamWins', { team: homeName })],
    ['draw', t('scenarios.draw')],
    ['away', t('scenarios.teamWins', { team: awayName })],
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Flag teamId={scenario.home.team_id} />
          <span>{homeName}</span>
          <span className="text-slate-400">v</span>
          <Flag teamId={scenario.away.team_id} />
          <span>{awayName}</span>
        </h4>
        {scenario.dead_rubber && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {t('scenarios.deadRubber')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {columns.map(([outcome, label]) => {
          const highlight = outcome === 'draw' && scenario.convenience_draw;
          const [home, away] = scenario.outcomes[outcome];
          return (
            <div
              key={outcome}
              className={`rounded-md border p-2 ${
                highlight ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-100 bg-slate-50/50'
              }`}
            >
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {label}
              </div>
              <div className="space-y-1.5">
                <OutcomeBadge outcome={home} locale={locale} prob={probByTeam?.get(home.team_id)} t={t} />
                <OutcomeBadge outcome={away} locale={locale} prob={probByTeam?.get(away.team_id)} t={t} />
              </div>
              {outcome === 'draw' && scenario.convenience_draw && (
                <p className="mt-1.5 text-[10px] font-medium text-emerald-700">{t('scenarios.convenienceDraw')}</p>
              )}
              {outcome === 'draw' && scenario.convenience_draw_kind === 'mutual_3rd_conditional' && (
                <p className="mt-1.5 text-[10px] text-amber-700">{t('scenarios.mutualThird')}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
