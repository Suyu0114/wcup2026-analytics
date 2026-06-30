import { useTranslations } from 'next-intl';
import type { BracketMatch, BracketSlot } from '@/lib/bracket';
import type { BracketSlotTeam } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';
import Flag from './Flag';

// One knockout match card, shared by the desktop tree and the mobile round tabs (P15).
// When a projected occupant exists (P14 bracket_slot_sim) it leads with flag + team; the
// probability is shown only when it's NOT effectively certain (group stage still open), so a
// settled bracket reads like the real thing rather than a wall of "100.0%". Server-compatible.

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
  locale,
}: {
  match: BracketMatch;
  projected?: Record<string, BracketSlotTeam>;
  locale: Locale;
}) {
  const t = useTranslations();

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
