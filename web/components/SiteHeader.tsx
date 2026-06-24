import { useTranslations } from 'next-intl';
import { Link } from '@/lib/routing';
import LanguageSwitcher from './LanguageSwitcher';
import MobileNav from './MobileNav';

const NAV_ITEMS = [
  { href: '/matches', labelKey: 'nav.matches' },
  { href: '/results', labelKey: 'nav.results' },
  { href: '/track-record', labelKey: 'nav.trackRecord' },
  { href: '/standings', labelKey: 'nav.standings' },
  { href: '/scenarios', labelKey: 'nav.scenarios' },
  { href: '/groups', labelKey: 'nav.groups' },
  { href: '/bracket', labelKey: 'nav.bracket' },
  { href: '/value', labelKey: 'nav.value' },
  { href: '/guide', labelKey: 'nav.guide' },
] as const;

export default function SiteHeader() {
  const t = useTranslations();
  return (
    <header className="relative border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-slate-900">
          {t('common.siteName')}
        </Link>
        <div className="flex items-center gap-3">
          <nav className="hidden items-center gap-4 text-sm md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-600 hover:text-slate-900"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher />
          <MobileNav items={NAV_ITEMS.map((i) => ({ ...i }))} />
        </div>
      </div>
    </header>
  );
}
