import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

// Bilingual: zh-TW default, en toggle (spec D2 / §3.1).
export const routing = defineRouting({
  locales: ['zh-TW', 'en'],
  defaultLocale: 'zh-TW',
});

export type Locale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
