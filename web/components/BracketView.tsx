import { useTranslations } from 'next-intl';
import {
  BRACKET_COLUMNS,
  bracketMatchesByStage,
  type BracketMatch,
  type BracketSlot,
  type KnockoutStage,
} from '@/lib/bracket';
import type { BracketSlotTeam } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { formatPercent } from '@/lib/format';

// The canonical knockout bracket as columns R32→Final (third-place play-off shown apart).
// Always renders the structural slot template (from engine/bracket.py via bracket.data.json).
// When `projected` is supplied (P14 bracket_slot_sim) the R32 cells also show the most-likely
// occupant of each slot + probability — experimental, model-only. Server-compatible.

// The DB/engine stage value '3rd' maps to the i18n key 'third'.
function stageLabelKey(stage: KnockoutStage): string {
  return stage === '3rd' ? 'stage.third' : `stage.${stage}`;
}

export default function BracketView({
  projected,
  locale = 'en',
}: {
  projected?: Record<string, BracketSlotTeam>;
  locale?: Locale;
} = {}) {
  const t = useTranslations();

  function slotLabel(slot: BracketSlot): string {
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

  function Side({ slot, occupant }: { slot: BracketSlot; occupant?: BracketSlotTeam }) {
    return (
      <div>
        <div className="truncate text-slate-700">{slotLabel(slot)}</div>
        {occupant && (
          <div className="truncate text-[11px] font-medium text-sky-700">
            {displayTeamName(occupant, locale)}{' '}
            <span className="tabular-nums text-sky-500">{formatPercent(occupant.prob)}</span>
          </div>
        )}
      </div>
    );
  }

  function Cell({ m }: { m: BracketMatch }) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
          {t('bracket.matchNo', { n: m.match_no })}
        </div>
        <div className="space-y-0.5">
          <Side slot={m.home} occupant={projected?.[`${m.match_no}-home`]} />
          <div className="text-[10px] text-slate-300">vs</div>
          <Side slot={m.away} occupant={projected?.[`${m.match_no}-away`]} />
        </div>
      </div>
    );
  }

  const thirdPlace = bracketMatchesByStage('3rd');

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {BRACKET_COLUMNS.map((stage) => (
            <div key={stage} className="flex w-44 shrink-0 flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t(stageLabelKey(stage) as 'stage.r32')}
              </h3>
              {bracketMatchesByStage(stage).map((m) => (
                <Cell key={m.match_no} m={m} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {thirdPlace.length > 0 && (
        <div className="w-44">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('bracket.thirdPlaceTitle')}
          </h3>
          <div className="mt-2">
            <Cell m={thirdPlace[0]} />
          </div>
        </div>
      )}
    </div>
  );
}
