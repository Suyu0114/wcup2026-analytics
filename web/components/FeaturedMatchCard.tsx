import { useTranslations } from 'next-intl';
import type { MatchView } from '@/lib/types';
import { Link, type Locale } from '@/lib/routing';
import { HFA_ELO, HOST_NATIONS } from '@/lib/constants';
import { computeRiskTiers, type Selection } from '@/lib/suggestions';
import { topScorelines } from '@/lib/scorelines';
import { displayTeamName } from '@/lib/teamName';
import { formatKickoff, formatPercent } from '@/lib/format';
import ProbBar from './ProbBar';
import ExperimentalTag from './ExperimentalTag';
import InfoPopover from './InfoPopover';
import UpsetBadge from './UpsetBadge';
import DivergenceBadge from './DivergenceBadge';
import FreshnessIndicator from './FreshnessIndicator';
import Flag from './Flag';

const HOST_TAGLINE_KEY: Record<string, string> = {
  CA: 'featured.tagline_CA',
  US: 'featured.tagline_US',
  MX: 'featured.tagline_MX',
};

const TIER_ROWS: { tier: 'steady' | 'medium' | 'risky'; labelKey: string; chip: string }[] = [
  { tier: 'steady', labelKey: 'featured.tierSteady', chip: 'bg-emerald-100 text-emerald-700' },
  { tier: 'medium', labelKey: 'featured.tierMedium', chip: 'bg-amber-100 text-amber-700' },
  { tier: 'risky', labelKey: 'featured.tierRisky', chip: 'bg-rose-100 text-rose-700' },
];

/**
 * Home-page featured card v2 — market-led: de-vig 1X2 bars + probability-based
 * risk tiers (lib/suggestions.ts; market only, no market → no tiers). The model
 * appears in exactly one place: the most-likely-scores hint (experimental tag),
 * with the full model on /matches. Tiers are risk labels, never value/EV claims
 * (featured.riskDisclaimer).
 */
export default function FeaturedMatchCard({
  match,
  locale,
  tz,
  isToday,
}: {
  match: MatchView;
  locale: Locale;
  tz: string;
  isToday: boolean;
}) {
  const t = useTranslations();
  const home = displayTeamName(match.home, locale);
  const away = displayTeamName(match.away, locale);
  const kickoff = formatKickoff(match.kickoff_utc, locale, tz);
  const novig = match.market?.pinnacle_novig ?? null;
  const tiers = computeRiskTiers(novig, match.market?.totals ?? null);

  const selectionLabel = (sel: Selection): string => {
    switch (sel.kind) {
      case 'dc_home':
        return t('featured.selDc', { team: home });
      case 'dc_away':
        return t('featured.selDc', { team: away });
      case 'home':
        return t('featured.selWin', { team: home });
      case 'away':
        return t('featured.selWin', { team: away });
      case 'over':
        return t('featured.selOver', { point: sel.point });
      case 'under':
        return t('featured.selUnder', { point: sel.point });
    }
  };

  const hostTaglineKey = HOST_NATIONS.has(match.home.team_id)
    ? HOST_TAGLINE_KEY[match.home.team_id]
    : null;

  // Reminder targets the MARKET favourite (card is market-led): P(not win) = 1 − P(win).
  const favoured = novig === null ? null : novig.home >= novig.away ? match.home : match.away;
  const notWin = novig === null ? null : 1 - Math.max(novig.home, novig.away);

  const scorelines = match.model
    ? topScorelines(match.model.lambda_home, match.model.lambda_away, 2)
    : null;
  const scorelineText = scorelines
    ?.map((s) => `${s.home}-${s.away} (${formatPercent(s.p, 0)})`)
    .join(locale === 'zh-TW' ? '、' : ', ');

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/60 to-white p-5 shadow-sm">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {isToday && (
            <span className="inline-block rounded bg-sky-600 px-1.5 py-0.5 text-xs font-semibold text-white">
              {t('featured.todayBadge')}
            </span>
          )}
          {match.group_label && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {t('groups.groupLabel')} {match.group_label}
            </span>
          )}
          {match.model?.upset.tier && <UpsetBadge tier={match.model.upset.tier} />}
          {match.divergence?.flag && <DivergenceBadge />}
        </div>
        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold text-slate-900">
          <span className="inline-flex items-center gap-1.5">
            <Flag teamId={match.home.team_id} />
            {home}
          </span>
          <span className="font-normal text-slate-400">vs</span>
          <span className="inline-flex items-center gap-1.5">
            <Flag teamId={match.away.team_id} />
            {away}
          </span>
        </h3>
        <div className="text-xs text-slate-500">
          {kickoff.local} · {kickoff.utc} {t('common.utc')}
        </div>
      </header>

      {novig ? (
        <div>
          <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {t('matches.marketLabel')}
            <InfoPopover body={t('matches.vigTooltip')} align="end" />
          </div>
          <div className="space-y-1">
            <ProbBar label={t('outcome.home')} value={novig.home} tone="market" />
            <ProbBar label={t('outcome.draw')} value={novig.draw} tone="market" />
            <ProbBar label={t('outcome.away')} value={novig.away} tone="market" />
          </div>
        </div>
      ) : (
        <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{t('matches.noMarket')}</p>
      )}

      {tiers && (
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white/70 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('featured.riskHeading')}
          </div>
          <ul className="space-y-1">
            {TIER_ROWS.map(({ tier, labelKey, chip }) => (
              <li key={tier} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${chip}`}>
                    {t(labelKey)}
                  </span>
                  <span className="text-slate-700">{selectionLabel(tiers[tier])}</span>
                </span>
                <span className="tabular-nums text-slate-800">{formatPercent(tiers[tier].p)}</span>
              </li>
            ))}
            {tiers.totals && (
              <li className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1 text-sm">
                <span className="flex items-center gap-2">
                  <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    {t('market.totals')}
                  </span>
                  <span className="text-slate-700">{selectionLabel(tiers.totals)}</span>
                </span>
                <span className="tabular-nums text-slate-800">{formatPercent(tiers.totals.p)}</span>
              </li>
            )}
          </ul>
          <p className="text-xs text-slate-400">{t('featured.riskDisclaimer')}</p>
        </div>
      )}

      {hostTaglineKey && (
        <p className="text-sm text-slate-600">
          🏟️ {t('featured.hostAdvantage', { elo: Math.round(HFA_ELO) })}{' '}
          <strong className="text-sky-700">{t(hostTaglineKey)}</strong>
        </p>
      )}

      {scorelineText && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
          <span>{t('featured.scorelineHint', { lines: scorelineText })}</span>
          <ExperimentalTag />
          <Link href="/matches" className="text-sky-700 hover:underline">
            {t('featured.fullModelLink')} →
          </Link>
        </p>
      )}

      {favoured && notWin !== null && (
        <p className="rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {t('featured.notWinReminder', {
            team: displayTeamName(favoured, locale),
            pct: formatPercent(notWin, 0),
          })}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
        {match.market?.freshness ? <FreshnessIndicator freshness={match.market.freshness} /> : <span />}
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
