import { useTranslations } from 'next-intl';
import { Link } from '@/lib/routing';

export default function NotFound() {
  const t = useTranslations();
  return (
    <div className="py-16 text-center">
      <p className="text-2xl font-bold text-slate-800">404</p>
      <Link href="/" className="mt-4 inline-block text-sky-600 hover:underline">
        {t('nav.home')}
      </Link>
    </div>
  );
}
