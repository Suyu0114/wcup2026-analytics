import { useTranslations } from 'next-intl';
import type { StandingRow } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import Flag from './Flag';

// One group's actual standings table (P8). Advancement is tiered (R2): in the 12-group
// format the top 2 advance directly and 8 best third-placed teams also reach R32 — so 3rd
// must NOT look eliminated. 1st/2nd = solid green left border, 3rd = dashed/lighter, 4th = none.

function advanceBorder(rank: number): string {
  if (rank <= 2) return 'border-l-4 border-emerald-500';
  if (rank === 3) return 'border-l-4 border-dashed border-emerald-300';
  return 'border-l-4 border-transparent';
}

export default function StandingsTable({
  group,
  teams,
  locale,
}: {
  group: string;
  teams: StandingRow[];
  locale: Locale;
}) {
  const t = useTranslations();
  const th = 'px-1.5 py-1 text-right font-medium text-slate-500';
  const td = 'px-1.5 py-1.5 text-right tabular-nums text-slate-700';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        {t('groups.groupLabel')} {group}
      </h3>
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-1 py-1 text-left font-medium text-slate-500">{t('standings.colPos')}</th>
            <th className="px-1.5 py-1 text-left font-medium text-slate-500">{t('standings.colTeam')}</th>
            <th className={th} title={t('standings.colPlayedFull')}>{t('standings.colPlayed')}</th>
            <th className={th} title={t('standings.colWinsFull')}>{t('standings.colWins')}</th>
            <th className={th} title={t('standings.colDrawsFull')}>{t('standings.colDraws')}</th>
            <th className={th} title={t('standings.colLossesFull')}>{t('standings.colLosses')}</th>
            <th className={`${th} hidden sm:table-cell`} title={t('standings.colGFFull')}>{t('standings.colGF')}</th>
            <th className={`${th} hidden sm:table-cell`} title={t('standings.colGAFull')}>{t('standings.colGA')}</th>
            <th className={th} title={t('standings.colGDFull')}>{t('standings.colGD')}</th>
            <th className={`${th} font-semibold text-slate-700`} title={t('standings.colPtsFull')}>
              {t('standings.colPts')}
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team.team_id} className="border-b border-slate-100 last:border-0">
              <td className={`px-1 py-1.5 text-left tabular-nums text-slate-500 ${advanceBorder(team.rank)}`}>
                <span className="pl-1.5">{team.rank}</span>
                {team.tied && (
                  <span className="ml-0.5 text-slate-400" title={t('standings.tiedTooltip')}>=</span>
                )}
              </td>
              <td className="px-1.5 py-1.5 text-left">
                <span className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Flag teamId={team.team_id} />
                  <span className="truncate">{displayTeamName(team, locale)}</span>
                </span>
              </td>
              <td className={td}>{team.played}</td>
              <td className={td}>{team.wins}</td>
              <td className={td}>{team.draws}</td>
              <td className={td}>{team.losses}</td>
              <td className={`${td} hidden sm:table-cell`}>{team.gf}</td>
              <td className={`${td} hidden sm:table-cell`}>{team.ga}</td>
              <td className={td}>{team.gd > 0 ? `+${team.gd}` : team.gd}</td>
              <td className={`${td} font-semibold text-slate-900`}>{team.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
