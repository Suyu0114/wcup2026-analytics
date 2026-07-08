import { useTranslations } from 'next-intl';
import type { BracketMatch, BracketSlot } from '@/lib/bracket';
import type { BracketSlotTeam, MatchView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import Flag from './Flag';

// One knockout match card, shared by the desktop tree and the mobile round tabs (P15).
// Cell precedence (P17): REAL match (fact — fd row joined by match_no: teams in fd
// orientation, score, PK winner) → projected occupant (P14 bracket_slot_sim, model —
// muted sky style) → slot label. The probability is shown only when it's NOT effectively
// certain, so a settled bracket reads like the real thing. Server-compatible.

type Tt = ReturnType<typeof useTranslations>;

function slotLabel(t: Tt, slot: BracketSlot): string {
  switch (slot.type) {
    case 'winner':
      return t('bracket.slotWinner', { group: slot.group });
    case 'runner_up':
      return t('bracket.slotRunnerUp', { group: slot.group });
    case 'third':
      return t('bracket.slotThird', { groups: slot.candidates.join('/') });
    case 'match_winner':
      return t('bracket.slotMatchWinner', { n: slot.feeder });
    case 'match_loser':
      return t('bracket.slotMatchLoser', { n: slot.feeder });
  }
}

export default function BracketCell({
  match,
  projected,
  real,
  locale,
}: {
  match: BracketMatch;
  projected?: Record<string, BracketSlotTeam>;
  real?: Record<number, MatchView>;
  locale: Locale;
}) {
  const t = useTranslations();
  const rm = real?.[match.match_no];

  if (rm) {
    const settled = rm.status === 'final';
    const hasScore = rm.home_goals !== null && rm.away_goals !== null;
    // Winner: fd's winner column, else decisive goals (fd fullTime for knockout is
    // cumulative reg + ET + pens, so a settled knockout score is always decisive).
    const winnerSide: 'home' | 'away' | null = settled
      ? (rm.winner ??
        (hasScore && rm.home_goals !== rm.away_goals
          ? rm.home_goals! > rm.away_goals!
            ? 'home'
            : 'away'
          : null))
      : null;
    const endedMark =
      settled && rm.result_duration === 'pk'
        ? t('bracket.pk')
        : settled && rm.result_duration === 'et'
          ? t('bracket.aet')
          : null;

    const realRow = (side: 'home' | 'away') => {
      const team = side === 'home' ? rm.home : rm.away;
      const goals = side === 'home' ? rm.home_goals : rm.away_goals;
      const isWinner = winnerSide === side;
      const dimmed = settled && winnerSide !== null && !isWinner;
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <Flag teamId={team.team_id} />
          <span
            className={`truncate ${
              isWinner ? 'font-semibold text-slate-900' : dimmed ? 'text-slate-500' : 'font-medium text-slate-900'
            }`}
          >
            {displayTeamName(team, locale)}
          </span>
          {isWinner && endedMark && (
            <span className="shrink-0 text-[10px] font-medium text-slate-500">{endedMark}</span>
          )}
          {hasScore && rm.status !== 'scheduled' && (
            <span
              className={`ml-auto shrink-0 tabular-nums ${
                isWinner ? 'font-semibold text-slate-900' : 'text-slate-600'
              }`}
            >
              {goals}
            </span>
          )}
        </div>
      );
    };

    return (
      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm">
        <div className="mb-0.5 flex items-center justify-between text-[10px] uppercase tracking-wide">
          {rm.status === 'live' ? (
            <span className="font-semibold text-rose-600">{t('bracket.live')}</span>
          ) : (
            <span />
          )}
          <span className="text-slate-400">{t('bracket.matchNo', { n: match.match_no })}</span>
        </div>
        {realRow('home')}
        <div className="border-t border-slate-100" />
        {realRow('away')}
      </div>
    );
  }

  function TeamRow({ slot, side }: { slot: BracketSlot; side: 'home' | 'away' }) {
    const occ = projected?.[`${match.match_no}-${side}`];
    if (occ) {
      const certain = occ.prob >= 0.995;
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <Flag teamId={occ.team_id} />
          <span className="truncate font-medium text-slate-800">{displayTeamName(occ, locale)}</span>
          {!certain && (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-sky-600">
              {formatPercent(occ.prob, 0)}
            </span>
          )}
        </div>
      );
    }
    return <div className="truncate py-0.5 text-slate-500">{slotLabel(t, slot)}</div>;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
      <div className="mb-0.5 text-right text-[10px] uppercase tracking-wide text-slate-400">
        {t('bracket.matchNo', { n: match.match_no })}
      </div>
      <TeamRow slot={match.home} side="home" />
      <div className="border-t border-slate-100" />
      <TeamRow slot={match.away} side="away" />
    </div>
  );
}
