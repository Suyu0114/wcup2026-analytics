import { useTranslations } from 'next-intl';
import InfoPopover from './InfoPopover';

// Plain visual pill (no popover) — reused by the badge (on cards) and the legend (in filters),
// so the badge appearance has a single source of truth.
export function UpsetPill() {
  const t = useTranslations();
  return (
    <span className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700">
      {t('upset.badge')}
    </span>
  );
}

export default function UpsetBadge() {
  const t = useTranslations();
  return (
    <InfoPopover body={t('upset.tooltip')}>
      <UpsetPill />
    </InfoPopover>
  );
}
