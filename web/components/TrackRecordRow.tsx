import { useTranslations } from 'next-intl';
import type { TrackRecordRow as Row } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import Flag from './Flag';
import { UpsetPill } from './UpsetBadge';

// One settled match: model pick + market favourite vs the actual result (P9). Model is always
// shown alongside the market (trap #7); ✓/✗ marks whether each side's most-likely pick matched.
// Server-compatible (next-intl useTranslations works in server components, like FixtureRow).

const RESULT_CHIP: Record<'won' | 'drew' | 'lost', string> = {
  won: 'bg-emerald-100 text-emerald-700',
  drew: 'bg-amber-100 text-amber-700',
  lost: 'bg-slate-100 text-slate-500',
};

function PickCell({ label, pick, hit }: { label: string; pick: string; hit: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="flex items-center gap-1 font-medium text-slate-700">
        {pick}
        <span className={hit ? 'text-emerald-600' : 'text-slate-300'}>{hit ? '✓' : '✗'}</span>
      </span>
    </div>
  );
}

export default function TrackRecordRow({ row, locale }: { row: Row; locale: Locale }) {
  const t = useTranslations();
  const { home, away, home_goals, away_goals, group_label, stage, actual, model, market, upset } = row;
  const outcomeLabel = (o: string) => t(`outcome.${o}` as 'outcome.home');

  const sectionLabel = group_label
    ? `${t('groups.groupLabel')} ${group_label}`
    : t(`stage.${stage}` as 'stage.group');

  const weakerName =
    upset && (upset.weaker === home.team_id ? displayTeamName(home, locale) : displayTeamName(away, locale));

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{sectionLabel}</span>
        {upset && (
          <span className="flex items-center gap-1.5">
            <UpsetPill tier={upset.tier} />
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RESULT_CHIP[upset.result]}`}>
              {t('trackRecord.weakerLabel')}: {t(`trackRecord.upset_${upset.result}` as 'trackRecord.upset_won')}
            </span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center justify-end gap-1.5 text-right text-sm font-medium text-slate-800">
          <span className="truncate">{displayTeamName(home, locale)}</span>
          <Flag teamId={home.team_id} />
        </div>
        <div className="min-w-[3.25rem] text-center">
          <span className="text-base font-semibold tabular-nums text-slate-900">
            {home_goals} <span className="text-slate-400">-</span> {away_goals}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-left text-sm font-medium text-slate-800">
          <Flag teamId={away.team_id} />
          <span className="truncate">{displayTeamName(away, locale)}</span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-1.5 border-t border-slate-100 pt-2 text-sm">
        <PickCell label={t('trackRecord.colModel')} pick={outcomeLabel(model.pick)} hit={model.hit} />
        {market ? (
          <PickCell label={t('trackRecord.colMarket')} pick={outcomeLabel(market.pick)} hit={market.hit} />
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">{t('trackRecord.colMarket')}</span>
            <span className="text-slate-400">{t('trackRecord.noMarketPick')}</span>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">{t('trackRecord.colActual')}</span>
          <span className="font-semibold text-slate-900">{outcomeLabel(actual)}</span>
        </div>
        {weakerName && (
          <div className="ml-auto text-[11px] text-slate-400">
            {t('trackRecord.weakerLabel')}: {weakerName}
          </div>
        )}
      </div>
    </div>
  );
}
