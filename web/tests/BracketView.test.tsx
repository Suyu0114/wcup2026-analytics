// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import BracketView from '../components/BracketView';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

describe('BracketView', () => {
  it('renders round tabs and switches the active round', () => {
    renderWithIntl(<BracketView locale="en" />);
    const r32Tab = screen.getByRole('tab', { name: en.stage.r32 });
    const finalTab = screen.getByRole('tab', { name: en.stage.final });
    expect(r32Tab.getAttribute('aria-selected')).toBe('true'); // R32 active by default

    fireEvent.click(finalTab);
    expect(finalTab.getAttribute('aria-selected')).toBe('true');
    expect(r32Tab.getAttribute('aria-selected')).toBe('false');
  });

  it('shows the projected occupant team for an R32 slot', () => {
    const projected = {
      '73-home': {
        match_no: 73,
        side: 'home' as const,
        team_id: 'ZA',
        name_en: 'South Africa',
        name_zh: null,
        prob: 1,
      },
    };
    renderWithIntl(<BracketView projected={projected} locale="en" />);
    // M73 renders in both the mobile R32 list and the desktop tree
    expect(screen.getAllByText('South Africa').length).toBeGreaterThan(0);
  });
});
