import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../messages/en.json';
import zhTW from '../messages/zh-TW.json';

const MESSAGES = { en, 'zh-TW': zhTW } as const;
export type TestLocale = keyof typeof MESSAGES;

// Render a component inside the i18n provider. Assertions reference the dictionary values
// (e.g. en.matches.noMarket) rather than literal strings or Tailwind classes, so they survive
// copy/styling changes and only break if the actual behaviour changes.
export function renderWithIntl(ui: ReactElement, locale: TestLocale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={MESSAGES[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

export { en, zhTW };
