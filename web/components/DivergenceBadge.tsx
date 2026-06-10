import { useTranslations } from 'next-intl';

// Neutral indigo — deliberately NOT red/green (EV value semantics) nor rose (upset), so the
// badge reads as "the two views disagree", never as "value here" (trap #7 / P5 risk #1).
export default function DivergenceBadge() {
  const t = useTranslations();
  return (
    <span
      title={t('divergence.tooltip')}
      className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
    >
      {t('divergence.badge')}
    </span>
  );
}
