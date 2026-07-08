import { useTranslations } from 'next-intl';
import type { MatchView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import Flag from './Flag';
import ModelVsMarket from './ModelVsMarket';

// One drawn knockout matchup: model 1X2 alongside the market (trap #7) plus the single-match
// advance probability. Advance% = win expectancy We = p_win + ½·p_draw — the right "who goes
// through" quantity for a no-draw tie incl. extra time / penalties (trap #6). Server-compatible.
export default function KnockoutMatchCard({ match, locale }: { match: MatchView; locale: Locale }) {
  const t = useTranslations();
  const { home, away, model, market, stage } = match;
  const stageKey = stage === '3rd' ? 'stage.third' : `stage.${stage}`;
  const we = model
    ? { home: model.p_home + 0.5 * model.p_draw, away: model.p_away + 0.5 * model.p_draw }
    : null;
  // P17: settled/live cards lead with the real score. fd fullTime is cumulative
  // (reg + ET + pens), so the PK/aet context comes from result_duration.
  const hasScore = match.home_goals !== null && match.away_goals !== null;
  const showScore = hasScore && (match.status === 'final' || match.status === 'live');
  const endedNote =
    match.status === 'final' && match.result_duration === 'pk'
      ? t('bracket.pk')
      : match.status === 'final' && match.result_duration === 'et'
        ? t('bracket.aet')
        : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">
        {t(stageKey as 'stage.r32')}
      </div>

      <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center justify-end gap-1.5 text-right text-sm font-medium text-slate-800">
          <span className="truncate">{displayTeamName(home, locale)}</span>
          <Flag teamId={home.team_id} />
        </div>
        {showScore ? (
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            {match.home_goals}–{match.away_goals}
          </span>
        ) : (
          <span className="text-xs text-slate-400">vs</span>
        )}
        <div className="flex min-w-0 items-center justify-start gap-1.5 text-left text-sm font-medium text-slate-800">
          <Flag teamId={away.team_id} />
          <span className="truncate">{displayTeamName(away, locale)}</span>
        </div>
      </div>

      {endedNote && <div className="mb-2 text-center text-xs text-slate-500">{endedNote}</div>}

      {we && (
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>{t('bracket.toAdvance')}</span>
          <span className="tabular-nums">
            {(we.home * 100).toFixed(0)}% · {(we.away * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {model ? (
        <ModelVsMarket
          model={{ home: model.p_home, draw: model.p_draw, away: model.p_away }}
          market={market?.pinnacle_novig ?? null}
        />
      ) : (
        <p className="text-sm text-slate-400">{t('matches.predictionsEmpty')}</p>
      )}
    </div>
  );
}
