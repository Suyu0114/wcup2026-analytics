// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import AttributionFooter from '../components/AttributionFooter';
import ResponsibleGamblingFooter from '../components/ResponsibleGamblingFooter';
import { renderWithIntl, en, zhTW } from './testUtils';

afterEach(cleanup);

// TU9: every page carries the Elo CC BY-SA 4.0 attribution + the market-efficiency disclaimer.
// AttributionFooter is mounted in the root layout, so testing the component covers the content;
// we assert the clean (single-text-node) disclaimer + the license/source links by role.
describe('AttributionFooter (TU9)', () => {
  it('shows the market-efficiency disclaimer and CC BY-SA / source links (en)', () => {
    renderWithIntl(<AttributionFooter />);
    expect(screen.getByText(en.footer.marketEfficiency)).toBeTruthy();
    const license = screen.getByRole('link', { name: en.footer.attributionLinkText });
    expect(license.getAttribute('href')).toContain('creativecommons.org/licenses/by-sa/4.0');
    const source = screen.getByRole('link', { name: 'eloratings.net' });
    expect(source.getAttribute('href')).toContain('eloratings.net');
  });

  it('renders the disclaimer bilingually (zh-TW)', () => {
    renderWithIntl(<AttributionFooter />, 'zh-TW');
    expect(screen.getByText(zhTW.footer.marketEfficiency)).toBeTruthy();
    expect(screen.getByRole('link', { name: zhTW.footer.attributionLinkText })).toBeTruthy();
  });
});

// TU12: the responsible-gambling footer (mandatory on /value) renders its title + body.
describe('ResponsibleGamblingFooter (TU12)', () => {
  it('shows the responsible-gambling title + body (en)', () => {
    renderWithIntl(<ResponsibleGamblingFooter />);
    expect(screen.getByText(en.footer.responsibleTitle)).toBeTruthy();
    expect(screen.getByText(en.footer.responsibleBody)).toBeTruthy();
  });

  it('renders bilingually (zh-TW)', () => {
    renderWithIntl(<ResponsibleGamblingFooter />, 'zh-TW');
    expect(screen.getByText(zhTW.footer.responsibleTitle)).toBeTruthy();
    expect(screen.getByText(zhTW.footer.responsibleBody)).toBeTruthy();
  });
});
