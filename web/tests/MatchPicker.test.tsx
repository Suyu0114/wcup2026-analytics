// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import MatchPicker, { type MatchOption } from '../components/MatchPicker';
import { renderWithIntl, en } from './testUtils';

afterEach(cleanup);

const OPTIONS: MatchOption[] = [
  {
    id: 'm1',
    label: 'Mexico vs South Africa',
    home: { teamId: 'MX', name: 'Mexico' },
    away: { teamId: 'ZA', name: 'South Africa' },
    group: 'A',
  },
  {
    id: 'm2',
    label: 'USA vs Canada',
    home: { teamId: 'US', name: 'USA' },
    away: { teamId: 'CA', name: 'Canada' },
    group: 'B',
  },
];

describe('MatchPicker', () => {
  it('shows the current selection on the trigger; the panel is closed initially', () => {
    renderWithIntl(<MatchPicker options={OPTIONS} value="m1" onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /Mexico/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on click and lists every option with a search box', () => {
    renderWithIntl(<MatchPicker options={OPTIONS} value="m1" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mexico/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByPlaceholderText(en.value.searchTeam)).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('filters the list by team name as you type (debounced)', async () => {
    renderWithIntl(<MatchPicker options={OPTIONS} value="m1" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mexico/ }));
    fireEvent.change(screen.getByPlaceholderText(en.value.searchTeam), { target: { value: 'canada' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option', { name: /Canada/ })).toBeTruthy();
  });

  it('shows a no-match message when nothing matches', async () => {
    renderWithIntl(<MatchPicker options={OPTIONS} value="m1" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mexico/ }));
    fireEvent.change(screen.getByPlaceholderText(en.value.searchTeam), { target: { value: 'zzz' } });
    expect(await screen.findByText(en.value.noMatchFound)).toBeTruthy();
  });

  it('calls onChange with the picked id and closes the panel', () => {
    const onChange = vi.fn();
    renderWithIntl(<MatchPicker options={OPTIONS} value="m1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Mexico/ }));
    fireEvent.click(screen.getByRole('option', { name: /Canada/ }));
    expect(onChange).toHaveBeenCalledWith('m2');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape', () => {
    renderWithIntl(<MatchPicker options={OPTIONS} value="m1" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mexico/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('falls back to the plain label when an option has no team data', () => {
    renderWithIntl(<MatchPicker options={[{ id: 'x', label: 'A vs B' }]} value="x" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /A vs B/ })).toBeTruthy();
  });
});
