// Typed wrapper over the canonical knockout-bracket structure (P13).
//
// SINGLE SOURCE OF TRUTH is engine/bracket.py. bracket.data.json is GENERATED
// from it (web/tests/fixtures/gen_bracket.py) and guarded by a parity test
// (tests/test_bracket.py). Do NOT hand-edit bracket.data.json — regenerate it.
import bracketData from './bracket.data.json';

export type KnockoutStage = 'r32' | 'r16' | 'qf' | 'sf' | '3rd' | 'final';

// A participant reference in a knockout match. Pre-draw the page renders the
// slot label (e.g. "Runner-up A", "3rd A/B/C/D/F", "Winner of M74"); once the
// draw fills the real teams these are matched to `matches` rows by match_no.
export type BracketSlot =
  | { type: 'winner'; group: string }
  | { type: 'runner_up'; group: string }
  | { type: 'third'; candidates: string[] }
  | { type: 'match_winner'; feeder: number }
  | { type: 'match_loser'; feeder: number };

export interface BracketMatch {
  match_no: number; // FIFA schedule number (73–104)
  stage: KnockoutStage;
  home: BracketSlot;
  away: BracketSlot;
}

interface BracketData {
  groups: string[];
  stage_ranges: Record<string, [number, number]>;
  matches: Record<string, BracketMatch>;
}

const DATA = bracketData as unknown as BracketData;

export const BRACKET_GROUPS: string[] = DATA.groups;

// Main-bracket column order (the third-place play-off '3rd' is rendered apart).
export const BRACKET_COLUMNS: KnockoutStage[] = ['r32', 'r16', 'qf', 'sf', 'final'];

export const BRACKET_MATCHES: BracketMatch[] = Object.values(DATA.matches).sort(
  (a, b) => a.match_no - b.match_no,
);

export function bracketMatchesByStage(stage: KnockoutStage): BracketMatch[] {
  return BRACKET_MATCHES.filter((m) => m.stage === stage);
}

export function bracketMatch(matchNo: number): BracketMatch | undefined {
  return DATA.matches[String(matchNo)];
}

/** The feeder match number of a slot (winner/loser of an earlier match), else null. */
export function feederOf(slot: BracketSlot): number | null {
  return slot.type === 'match_winner' || slot.type === 'match_loser' ? slot.feeder : null;
}

// Display order: match_no order is SCRAMBLED vs the tree (e.g. R16 M89 is fed by R32 M74 &
// M77, which aren't adjacent). DFS from the Final assigns each R32 leaf a sequence index and
// each internal match the mean of its two feeders — so sorting a round by this index lines
// every match up vertically with its feeders. (The 3rd-place M103 isn't in the Final subtree.)
const ORDER: Record<number, number> = {};
(function computeOrder() {
  let leaf = 0;
  function assign(no: number): number {
    const m = DATA.matches[String(no)];
    const hf = feederOf(m.home);
    const af = feederOf(m.away);
    if (hf === null || af === null) {
      ORDER[no] = leaf++;
      return ORDER[no];
    }
    ORDER[no] = (assign(hf) + assign(af)) / 2;
    return ORDER[no];
  }
  assign(104);
})();

/** Matches of a stage in bracket DISPLAY order (top→bottom), not match_no order. */
export function bracketColumn(stage: KnockoutStage): BracketMatch[] {
  return bracketMatchesByStage(stage).sort(
    (a, b) => (ORDER[a.match_no] ?? 0) - (ORDER[b.match_no] ?? 0),
  );
}
