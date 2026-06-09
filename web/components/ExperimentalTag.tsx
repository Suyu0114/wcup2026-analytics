import { useTranslations } from 'next-intl';

// Reinforces D5 / trap #7: model output is never a standalone "answer".
export default function ExperimentalTag({ strong = false }: { strong?: boolean }) {
  const t = useTranslations();
  return (
    <span
      title={t('common.experimentalTooltip')}
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        strong ? 'bg-amber-200 text-amber-900' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {t('common.experimental')}
    </span>
  );
}
