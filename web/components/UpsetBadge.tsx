import { useTranslations } from 'next-intl';
import InfoPopover from './InfoPopover';
import type { UpsetTier } from '@/lib/constants';

const TIER_STYLE: Record<UpsetTier, string> = {
  'A+': 'bg-red-100 text-red-700',
  'A':  'bg-rose-100 text-rose-700',
  'B':  'bg-amber-100 text-amber-700',
};

const TIER_BADGE_KEY: Record<UpsetTier, string> = {
  'A+': 'upset.badge_aplus',
  'A':  'upset.badge_a',
  'B':  'upset.badge_b',
};

const TIER_TOOLTIP_KEY: Record<UpsetTier, string> = {
  'A+': 'upset.tooltip_aplus',
  'A':  'upset.tooltip_a',
  'B':  'upset.tooltip_b',
};

// Plain visual pill (no popover) — reused by the badge (on cards) and the legend (in filters),
// so the badge appearance has a single source of truth.
export function UpsetPill({ tier }: { tier: UpsetTier }) {
  const t = useTranslations();
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${TIER_STYLE[tier]}`}>
      {t(TIER_BADGE_KEY[tier])}
    </span>
  );
}

export default function UpsetBadge({ tier }: { tier: UpsetTier }) {
  const t = useTranslations();
  return (
    <InfoPopover body={t(TIER_TOOLTIP_KEY[tier])}>
      <UpsetPill tier={tier} />
    </InfoPopover>
  );
}
