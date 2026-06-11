import { useTranslations } from 'next-intl';
import type { MatchView } from '@/lib/types';
import { Link, type Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatKickoff, formatPercent } from '@/lib/format';
import ModelVsMarket from './ModelVsMarket';
import UpsetBadge from './UpsetBadge';
import DivergenceBadge from './DivergenceBadge';
import FreshnessIndicator from './FreshnessIndicator';
import Flag from './Flag';

export default function MatchCard({
  match,
  locale,
  tz,
}: {
  match: MatchView;
  locale: Locale;
  tz: string;
}) {
  const t = useTranslations();
  const home = displayTeamName(match.home, locale);
  const away = displayTeamName(match.away, locale);
  const kickoff = formatKickoff(match.kickoff_utc, locale, tz);

  return (
    <article className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-slate-900">
            <span className="inline-flex items-center gap-1.5">
              <Flag teamId={match.home.team_id} />
              {home}
            </span>
            <span className="text-slate-400">vs</span>
            <span className="inline-flex items-center gap-1.5">
              <Flag teamId={match.away.team_id} />
              {away}
            </span>
          </h3>
          {match.group_label && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {t('groups.groupLabel')} {match.group_label}
            </span>
          )}
          {match.model?.upset.flag && <UpsetBadge />}
          {match.divergence?.flag && <DivergenceBadge />}
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{kickoff.local}</div>
          <div className="text-slate-400">
            {kickoff.utc} {t('common.utc')}
          </div>
        </div>
      </header>

      {match.model ? (
        <>
          <ModelVsMarket
            model={{ home: match.model.p_home, draw: match.model.p_draw, away: match.model.p_away }}
            market={match.market?.pinnacle_novig ?? null}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-2 text-sm text-slate-600">
            <span>
              {t('matches.colOverUnder')}:{' '}
              <strong className="tabular-nums text-slate-800">{formatPercent(match.model.p_over_2_5)}</strong>
            </span>
            {match.model.p_btts != null && (
              <span>
                {t('matches.colBtts')}:{' '}
                <strong className="tabular-nums text-slate-800">{formatPercent(match.model.p_btts)}</strong>
              </span>
            )}
            <span className="text-slate-400">
              xG {match.model.exp_total_goals.toFixed(2)} · {t('common.modelVersion')} {match.model.model_version}
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400">{t('matches.predictionsEmpty')}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
        {match.market?.freshness ? (
          <FreshnessIndicator freshness={match.market.freshness} />
        ) : (
          <span />
        )}
        <Link
          href={`/value?match=${encodeURIComponent(match.match_id)}`}
          className="rounded bg-sky-50 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-100"
        >
          {t('matches.evCalculator')} →
        </Link>
      </div>
    </article>
  );
}
