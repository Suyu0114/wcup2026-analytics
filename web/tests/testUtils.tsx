import type { ComponentProps, ReactElement } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../messages/en.json';
import zhTW from '../messages/zh-TW.json';

const MESSAGES = { en, 'zh-TW': zhTW } as const;
export type TestLocale = keyof typeof MESSAGES;

// next-intl's message type rejects array values (e.g. guide.*.points string[]), though they
// work fine at runtime via t.raw(). Cast at this one provider boundary.
type IntlMessages = NonNullable<ComponentProps<typeof NextIntlClientProvider>['messages']>;

// Render a component inside the i18n provider. Assertions reference the dictionary values
// (e.g. en.matches.noMarket) rather than literal strings or Tailwind classes, so they survive
// copy/styling changes and only break if the actual behaviour changes.
export function renderWithIntl(ui: ReactElement, locale: TestLocale = 'en') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="UTC"
      messages={MESSAGES[locale] as unknown as IntlMessages}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

export { en, zhTW };
