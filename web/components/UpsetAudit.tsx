import { useTranslations } from 'next-intl';
import type { TrackRecordRow, TrackRecordSummary } from '@/lib/types';
import type { UpsetTier } from '@/lib/constants';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import Flag from './Flag';
import { UpsetPill } from './UpsetBadge';

// P9 feature 2: did the matches we TAGGED upset-risk actually upset? Leads with the
// underdog not-losing (win or draw — the tier's own basis), with the won-outright rate
// alongside, then a per-tier breakdown and the tagged matches with a won/drew/lost verdict.

const RESULT_CHIP: Record<'won' | 'drew' | 'lost', string> = {
  won: 'bg-emerald-100 text-emerald-700',
  drew: 'bg-amber-100 text-amber-700',
  lost: 'bg-slate-100 text-slate-500',
};

const TIERS: UpsetTier[] = ['A+', 'A', 'B'];

const rate = (n: number, total: number) => (total > 0 ? formatPercent(n / total, 0) : '—');

export default function UpsetAudit({
  rows,
  summary,
  locale,
}: {
  rows: TrackRecordRow[];
  summary: TrackRecordSummary['upset'];
  locale: Locale;
}) {
  const t = useTranslations();
  const tagged = rows.filter((r) => r.upset !== null);

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{t('trackRecord.upsetAuditTitle')}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{t('trackRecord.upsetAuditSubtitle')}</p>
      </div>

      {summary.total === 0 ? (
        <p className="rounded bg-white/70 px-3 py-2 text-sm text-slate-500">{t('trackRecord.upsetAuditEmpty')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-2xl font-bold tabular-nums text-amber-800">
                {summary.notLost}/{summary.total}
              </span>{' '}
              <span className="text-sm text-slate-600">
                {t('trackRecord.upsetNotLost')} ({rate(summary.notLost, summary.total)})
              </span>
            </div>
            <div className="text-sm text-slate-500">
              {t('trackRecord.upsetWonOutright')}:{' '}
              <span className="tabular-nums">
                {summary.won}/{summary.total} ({rate(summary.won, summary.total)})
              </span>
            </div>
          </div>

          <ul className="space-y-1">
            {TIERS.filter((tier) => summary.byTier[tier].total > 0).map((tier) => {
              const s = summary.byTier[tier];
              return (
                <li key={tier} className="flex items-center gap-2 text-sm">
                  <UpsetPill tier={tier} />
                  <span className="tabular-nums text-slate-700">
                    {t('trackRecord.upsetNotLost')} {s.notLost}/{s.total} · {t('trackRecord.upsetWonOutright')}{' '}
                    {s.won}/{s.total}
                  </span>
                </li>
              );
            })}
          </ul>

          <ul className="space-y-1.5 border-t border-amber-200/60 pt-2">
            {tagged.map((r) => {
              const u = r.upset!;
              const weakerName =
                u.weaker === r.home.team_id ? displayTeamName(r.home, locale) : displayTeamName(r.away, locale);
              return (
                <li key={r.match_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <UpsetPill tier={u.tier} />
                  <span className="inline-flex items-center gap-1 text-slate-700">
                    <Flag teamId={r.home.team_id} />
                    {displayTeamName(r.home, locale)}
                    <span className="font-semibold tabular-nums">
                      {' '}
                      {r.home_goals}-{r.away_goals}{' '}
                    </span>
                    {displayTeamName(r.away, locale)}
                    <Flag teamId={r.away.team_id} />
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{weakerName}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RESULT_CHIP[u.result]}`}>
                    {t(`trackRecord.upset_${u.result}` as 'trackRecord.upset_won')}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
