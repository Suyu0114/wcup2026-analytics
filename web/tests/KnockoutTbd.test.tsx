// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import KnockoutTbd from '../components/KnockoutTbd';
import { renderWithIntl, en, zhTW } from './testUtils';

afterEach(cleanup);

// TU4: knockout matchups are TBD before the draw — render a graceful placeholder, never crash,
// never fabricate a matchup. The placeholder is data-independent (no props), so it always shows.

describe('KnockoutTbd', () => {
  it('renders the TBD placeholder heading + description with no props (en)', () => {
    renderWithIntl(<KnockoutTbd />);
    expect(screen.getByText(en.matches.knockoutTbd)).toBeTruthy();
    expect(screen.getByText(en.matches.knockoutTbdDesc)).toBeTruthy();
  });

  it('renders the placeholder in zh-TW', () => {
    renderWithIntl(<KnockoutTbd />, 'zh-TW');
    expect(screen.getByText(zhTW.matches.knockoutTbd)).toBeTruthy();
    expect(screen.getByText(zhTW.matches.knockoutTbdDesc)).toBeTruthy();
  });
});
