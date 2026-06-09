import { useTranslations } from 'next-intl';
import type { GroupTeam } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import ProbBar from './ProbBar';

export default function GroupTable({
  group,
  teams,
  locale,
}: {
  group: string;
  teams: GroupTeam[];
  locale: Locale;
}) {
  const t = useTranslations();
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        {t('groups.groupLabel')} {group}
      </h3>
      <div className="space-y-3">
        {teams.map((team) => (
          <div key={team.team_id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-800">{displayTeamName(team, locale)}</span>
            </div>
            <ProbBar label={t('groups.pAdvance')} value={team.p_advance} tone="neutral" />
            <div className="flex gap-x-4 pl-16 text-xs text-slate-500">
              <span>
                {t('groups.pFirst')} {formatPercent(team.p_first)}
              </span>
              <span>
                {t('groups.pSecond')} {formatPercent(team.p_second)}
              </span>
              <span>
                {t('groups.pThirdQual')} {formatPercent(team.p_third_qual)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
