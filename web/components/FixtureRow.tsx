import { useTranslations } from 'next-intl';
import type { FixtureView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import Flag from './Flag';

// One fixture/result as a card. Shared by ScoreFilters (group stage, grouped by date)
// and the /results knockout branch (R4). Server-compatible (next-intl useTranslations
// works in both server and client components, like GroupTable/KnockoutTbd).

function kickoffTime(iso: string, locale: string, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale === 'en',
  }).format(new Date(iso));
}

export default function FixtureRow({
  fixture,
  locale,
  tz,
}: {
  fixture: FixtureView;
  locale: Locale;
  tz: string;
}) {
  const t = useTranslations();
  const { home, away, home_goals, away_goals, status, group_label, stage, kickoff_utc, result_duration } = fixture;
  const hasScore = home_goals !== null && away_goals !== null;

  const sectionLabel = group_label
    ? `${t('groups.groupLabel')} ${group_label}`
    : // '3rd' must map to 'stage.third' — next-intl treats '.' as a path separator (trap B2)
      t((stage === '3rd' ? 'stage.third' : `stage.${stage}`) as 'stage.group');
  // P17: how a settled knockout match ended. fd's fullTime is cumulative (reg + ET +
  // pens), so a shootout shows e.g. 4-5 — the PK marker gives that score its context.
  const endedNote =
    status === 'final' && result_duration === 'pk'
      ? t('bracket.pk')
      : status === 'final' && result_duration === 'et'
        ? t('bracket.aet')
        : null;
  const statusLabel =
    status === 'final' ? t('results.statusFinal')
    : status === 'live' ? t('results.statusLive')
    : t('results.statusScheduled');

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{sectionLabel}</span>
        <span className={status === 'live' ? 'font-semibold text-rose-600' : ''}>{statusLabel}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center justify-end gap-1.5 text-right text-sm font-medium text-slate-800">
          <span className="truncate">{displayTeamName(home, locale)}</span>
          <Flag teamId={home.team_id} />
        </div>
        <div className="min-w-[3.25rem] text-center">
          {hasScore ? (
            <>
              <span className="text-base font-semibold tabular-nums text-slate-900">
                {home_goals} <span className="text-slate-400">-</span> {away_goals}
              </span>
              {endedNote && <span className="block text-[10px] text-slate-500">{endedNote}</span>}
            </>
          ) : (
            <span className="text-sm tabular-nums text-slate-500">{kickoffTime(kickoff_utc, locale, tz)}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-left text-sm font-medium text-slate-800">
          <Flag teamId={away.team_id} />
          <span className="truncate">{displayTeamName(away, locale)}</span>
        </div>
      </div>
    </div>
  );
}
