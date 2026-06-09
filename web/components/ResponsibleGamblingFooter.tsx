import { useTranslations } from 'next-intl';

// Mandatory on /value (D7 / §6.5 / TU12), bilingual via active locale.
export default function ResponsibleGamblingFooter() {
  const t = useTranslations();
  return (
    <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">{t('footer.responsibleTitle')}</p>
      <p className="mt-1 text-amber-800">{t('footer.responsibleBody')}</p>
    </div>
  );
}
