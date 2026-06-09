import { useTranslations } from 'next-intl';

export default function UpsetBadge() {
  const t = useTranslations();
  return (
    <span
      title={t('upset.tooltip')}
      className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700"
    >
      {t('upset.badge')}
    </span>
  );
}
