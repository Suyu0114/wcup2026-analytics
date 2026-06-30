import { useTranslations } from 'next-intl';
import type { KnockoutTeam } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import Flag from './Flag';
import ExperimentalTag from './ExperimentalTag';

// P14 champion + per-round advancement, from the full-tournament Monte Carlo. MODEL output,
// always tagged experimental; there is no market to pair with (knockout outrights aren't
// ingested — trap #7 exception, same as P11 scenarios). Server-compatible.
export default function ChampionOdds({
  teams,
  locale,
  limit = 16,
}: {
  teams: KnockoutTeam[];
  locale: Locale;
  limit?: number;
}) {
  const t = useTranslations();
  if (teams.length === 0) return null;
  const leader = teams[0];
  const shown = teams.slice(0, limit);

  // Collapsible (native <details>, DEFAULT COLLAPSED) so the bracket below is reachable; the
  // summary line shows the current leader (P15). server-compatible — no client JS.
  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-3">
        <span className="text-lg font-semibold text-slate-900">{t('bracket.championTitle')}</span>
        <ExperimentalTag strong />
        <span className="ml-2 text-sm text-slate-500">
          {t('bracket.championSummary', {
            team: displayTeamName(leader, locale),
            pct: formatPercent(leader.p_champion),
          })}
        </span>
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">{t('bracket.championNote')}</p>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-1 pr-2 font-medium">{t('bracket.colTeam')}</th>
              <th className="py-1 px-2 text-right font-medium">{t('bracket.colChampion')}</th>
              <th className="py-1 px-2 text-right font-medium">{t('bracket.colFinal')}</th>
              <th className="py-1 px-2 text-right font-medium">{t('bracket.colSf')}</th>
              <th className="py-1 px-2 text-right font-medium">{t('bracket.colQf')}</th>
              <th className="py-1 pl-2 text-right font-medium">{t('bracket.colR16')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((tm) => (
              <tr key={tm.team_id} className="border-t border-slate-100">
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-1.5">
                    <Flag teamId={tm.team_id} />
                    <span className="truncate font-medium text-slate-800">{displayTeamName(tm, locale)}</span>
                    <span className="text-xs text-slate-400">{tm.group_label}</span>
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-sky-700">{formatPercent(tm.p_champion)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{formatPercent(tm.p_make_final)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{formatPercent(tm.p_make_sf)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{formatPercent(tm.p_make_qf)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-slate-600">{formatPercent(tm.p_make_r16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </details>
  );
}
