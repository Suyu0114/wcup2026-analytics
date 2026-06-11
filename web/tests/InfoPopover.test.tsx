// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import InfoPopover from '../components/InfoPopover';
import { renderWithIntl } from './testUtils';

afterEach(cleanup);

const BODY = 'The vig is the bookmaker cut.';

describe('InfoPopover', () => {
  it('is closed initially — the body is not rendered', () => {
    renderWithIntl(<InfoPopover body={BODY} />);
    expect(screen.queryByText(BODY)).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles the panel on click (tap path)', () => {
    renderWithIntl(<InfoPopover body={BODY} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it('opens on hover and closes on Escape', () => {
    renderWithIntl(<InfoPopover body={BODY} />);
    const wrapper = screen.getByRole('button').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText(BODY)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it('uses a passed child (badge) as the trigger', () => {
    renderWithIntl(
      <InfoPopover body="Upset explanation.">
        <span>Upset risk</span>
      </InfoPopover>,
    );
    expect(screen.getByText('Upset risk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Upset explanation.')).toBeTruthy();
  });
});
