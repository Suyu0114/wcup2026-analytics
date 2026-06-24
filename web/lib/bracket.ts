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
