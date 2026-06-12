import { useTranslations } from 'next-intl';
import { Link } from '@/lib/routing';
import LanguageSwitcher from './LanguageSwitcher';

export default function SiteHeader() {
  const t = useTranslations();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-slate-900">
          {t('common.siteName')}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/matches" className="text-slate-600 hover:text-slate-900">
            {t('nav.matches')}
          </Link>
          <Link href="/results" className="text-slate-600 hover:text-slate-900">
            {t('nav.results')}
          </Link>
          <Link href="/standings" className="text-slate-600 hover:text-slate-900">
            {t('nav.standings')}
          </Link>
          <Link href="/groups" className="text-slate-600 hover:text-slate-900">
            {t('nav.groups')}
          </Link>
          <Link href="/value" className="text-slate-600 hover:text-slate-900">
            {t('nav.value')}
          </Link>
          <Link href="/guide" className="text-slate-600 hover:text-slate-900">
            {t('nav.guide')}
          </Link>
          <LanguageSwitcher />
        </nav>
      </div>
    </header>
  );
}
