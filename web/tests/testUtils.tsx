import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../messages/en.json';

// Render a component inside the i18n provider. Assertions reference the dictionary values
// (e.g. en.matches.noMarket) rather than literal strings or Tailwind classes, so they survive
// copy/styling changes and only break if the actual behaviour changes.
export function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

export { en };
