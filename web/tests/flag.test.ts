import { describe, it, expect } from 'vitest';
import { flagCode } from '../lib/flag';

// Most team_ids are ISO 3166-1 alpha-2 (lowercased); EN/SQ are the two verified non-ISO overrides.
describe('flagCode', () => {
  it('lowercases ISO alpha-2 team_ids', () => {
    expect(flagCode('BR')).toBe('br');
    expect(flagCode('US')).toBe('us');
    expect(flagCode('KR')).toBe('kr');
    expect(flagCode('CI')).toBe('ci');
  });

  it('maps the non-ISO UK home nations to flag-icons subdivision codes', () => {
    expect(flagCode('EN')).toBe('gb-eng'); // England
    expect(flagCode('SQ')).toBe('gb-sct'); // Scotland
  });
});
