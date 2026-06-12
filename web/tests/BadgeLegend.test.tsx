// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import BadgeLegend from '../components/BadgeLegend';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

describe('BadgeLegend', () => {
  it('shows every badge label with its explanation as plain text (no tap needed)', () => {
    renderWithIntl(<BadgeLegend />);
    expect(screen.getByText(en.matches.legendTitle)).toBeTruthy();
    // tiered upset badges (A+/A/B): each pill label + its explanation
    for (const [badge, tooltip] of [
      [en.upset.badge_aplus, en.upset.tooltip_aplus],
      [en.upset.badge_a, en.upset.tooltip_a],
      [en.upset.badge_b, en.upset.tooltip_b],
    ] as const) {
      expect(screen.getByText(badge)).toBeTruthy();
      expect(screen.getByText(tooltip)).toBeTruthy();
    }
    // divergence badge: pill label + explanation
    expect(screen.getByText(en.divergence.badge)).toBeTruthy();
    expect(screen.getByText(en.divergence.tooltip)).toBeTruthy();
  });

  it('renders no interactive popover trigger (the pills are static)', () => {
    renderWithIntl(<BadgeLegend />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
