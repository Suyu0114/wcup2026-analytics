// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import OddsConverter from '../components/OddsConverter';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

describe('OddsConverter', () => {
  it('converts the default decimal 2.50 to the other formats + implied probability', () => {
    renderWithIntl(<OddsConverter />);
    expect(screen.getByText('+150')).toBeTruthy(); // american
    expect(screen.getByText('40.0%')).toBeTruthy(); // implied = 1/2.5
  });

  it('shows a graceful error for invalid odds (d ≤ 1), not a crash', () => {
    renderWithIntl(<OddsConverter />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } });
    expect(screen.getByText(en.value.errInvalidOdds)).toBeTruthy();
    expect(screen.queryByText('40.0%')).toBeNull();
  });
});
