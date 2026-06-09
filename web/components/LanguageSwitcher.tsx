'use client';

import { useLocale } from 'next-intl';
import { Link, usePathname, routing } from '@/lib/routing';

const LABEL: Record<string, string> = { 'zh-TW': '中', en: 'EN' };

export default function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 text-sm">
      {routing.locales.map((l) => (
        <Link
          key={l}
          href={pathname}
          locale={l}
          className={`rounded px-2 py-1 ${
            l === locale ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {LABEL[l] ?? l}
        </Link>
      ))}
    </div>
  );
}
