import { useTranslations } from 'next-intl';
import InfoPopover from './InfoPopover';

// Plain visual pill (no popover) — reused by the badge (on cards) and the legend (in filters).
// Neutral indigo — deliberately NOT red/green (EV value semantics) nor rose (upset), so the
// badge reads as "the two views disagree", never as "value here" (trap #7 / P5 risk #1).
export function DivergencePill() {
  const t = useTranslations();
  return (
    <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
      {t('divergence.badge')}
    </span>
  );
}

export default function DivergenceBadge() {
  const t = useTranslations();
  return (
    <InfoPopover body={t('divergence.tooltip')}>
      <DivergencePill />
    </InfoPopover>
  );
}
