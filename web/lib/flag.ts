// team_id (eloratings two-letter country_code) -> flag-icons code.
//
// Most team_ids are ISO 3166-1 alpha-2 (lowercase). Verified against the 48 teams in the DB,
// only two are non-ISO — the UK home nations — and map to flag-icons subdivision codes
// (verify-don't-assume / trap #1: codes are confirmed, not guessed).
const OVERRIDES: Record<string, string> = {
  EN: 'gb-eng', // England
  SQ: 'gb-sct', // Scotland
};

export function flagCode(teamId: string): string {
  return OVERRIDES[teamId] ?? teamId.toLowerCase();
}
