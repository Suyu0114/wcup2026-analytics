// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import BadgeLegend from '../components/BadgeLegend';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

describe('BadgeLegend', () => {
  it('shows both badge labels with their explanations as plain text (no tap needed)', () => {
    renderWithIntl(<BadgeLegend />);
    expect(screen.getByText(en.matches.legendTitle)).toBeTruthy();
    expect(screen.getByText(en.upset.badge)).toBeTruthy();
    expect(screen.getByText(en.upset.tooltip)).toBeTruthy();
    expect(screen.getByText(en.divergence.badge)).toBeTruthy();
    expect(screen.getByText(en.divergence.tooltip)).toBeTruthy();
  });

  it('renders no interactive popover trigger (the pills are static)', () => {
    renderWithIntl(<BadgeLegend />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
