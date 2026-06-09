import { useTranslations } from 'next-intl';

export default function Disclaimer() {
  const t = useTranslations();
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      {t('home.disclaimerBanner')}
    </div>
  );
}
