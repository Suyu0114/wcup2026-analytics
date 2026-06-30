'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  BRACKET_COLUMNS,
  bracketColumn,
  bracketMatch,
  feederOf,
  type BracketMatch,
  type KnockoutStage,
} from '@/lib/bracket';
import type { BracketSlotTeam } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import BracketCell from './BracketCell';

// ESPN-style knockout bracket (P15): a connected tree on desktop, round tabs on mobile.
// The tree is rendered RECURSIVELY from the Final (so each match's two feeders are siblings
// and naturally adjacent — match_no order is scrambled vs the tree); equal-flex feeder columns
// auto-centre each later round between its two feeders. The third-place play-off (M103) is
// shown apart (it isn't in the Final's subtree). Client island: only the mobile tab is stateful.

function stageLabelKey(stage: KnockoutStage): 'stage.r32' {
  return (stage === '3rd' ? 'stage.third' : `stage.${stage}`) as 'stage.r32';
}

export default function BracketView({
  projected,
  locale = 'en',
}: {
  projected?: Record<string, BracketSlotTeam>;
  locale?: Locale;
} = {}) {
  const t = useTranslations();
  const [active, setActive] = useState<KnockoutStage>('r32');

  const cell = (m: BracketMatch) => <BracketCell match={m} projected={projected} locale={locale} />;
  const thirdPlace = bracketColumn('3rd');

  function renderNode(matchNo: number): ReactNode {
    const m = bracketMatch(matchNo)!;
    const hf = feederOf(m.home);
    const af = feederOf(m.away);

    if (hf === null || af === null) {
      return (
        <div className="flex flex-1 items-center py-1">
          <div className="w-44 shrink-0">{cell(m)}</div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-stretch">
        <div className="flex flex-col">
          {renderNode(hf)}
          {renderNode(af)}
        </div>
        {/* elbow connector: two feeder stubs → vertical spine → horizontal into this card */}
        <div className="relative w-6 shrink-0 before:absolute before:left-0 before:right-1/2 before:top-1/4 before:border-t before:border-slate-300 before:content-[''] after:absolute after:left-0 after:right-1/2 after:bottom-1/4 after:border-t after:border-slate-300 after:content-['']">
          <span className="absolute bottom-1/4 left-1/2 top-1/4 border-l border-slate-300" />
          <span className="absolute left-1/2 right-0 top-1/2 border-t border-slate-300" />
        </div>
        <div className="flex items-center py-1">
          <div className="w-44 shrink-0">{cell(m)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* mobile: round tabs + the active round's cards */}
      <div className="md:hidden">
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
          {BRACKET_COLUMNS.map((s) => {
            const isActive = s === active;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(s)}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t(stageLabelKey(s))}
              </button>
            );
          })}
        </div>
        <div className="space-y-2">
          {bracketColumn(active).map((m) => (
            <div key={m.match_no}>{cell(m)}</div>
          ))}
          {active === 'final' && thirdPlace.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('bracket.thirdPlaceTitle')}
              </div>
              {cell(thirdPlace[0])}
            </div>
          )}
        </div>
      </div>

      {/* desktop: connected tree */}
      <div className="hidden md:block">
        <div className="overflow-x-auto pb-2">
          <div className="min-w-max">
            <div className="mb-2 flex">
              {BRACKET_COLUMNS.map((s) => (
                <div
                  key={s}
                  className="w-[12.5rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 last:w-44"
                >
                  {t(stageLabelKey(s))}
                </div>
              ))}
            </div>
            {renderNode(104)}
          </div>
        </div>
        {thirdPlace.length > 0 && (
          <div className="mt-4 w-44">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('bracket.thirdPlaceTitle')}
            </div>
            {cell(thirdPlace[0])}
          </div>
        )}
      </div>
    </div>
  );
}
