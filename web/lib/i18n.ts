import { getRequestConfig } from 'next-intl/server';
import { routing, type Locale } from './routing';

// next-intl request config (referenced by next.config.mjs plugin).
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
