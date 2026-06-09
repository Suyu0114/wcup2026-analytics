/**
 * Team name resolution (spec §3.2). zh-TW uses the curated teams.name_zh lookup; never
 * machine-translate country names (P0-P1 §3 i18n note). name_zh null → fallback to name_en
 * (flagged in UI, not silently faked).
 */
import type { Locale } from './routing';

export interface TeamLike {
  team_id: string;
  name_en: string;
  name_zh?: string | null;
}

export function displayTeamName(team: TeamLike, locale: Locale): string {
  if (locale === 'zh-TW') {
    return team.name_zh ?? team.name_en; // fallback, never MT
  }
  return team.name_en;
}

export function anyZhNameMissing(teams: TeamLike[]): boolean {
  return teams.some((t) => !t.name_zh);
}
