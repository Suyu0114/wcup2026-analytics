import { useTranslations } from 'next-intl';
import { UpsetPill } from './UpsetBadge';
import { DivergencePill } from './DivergenceBadge';

// Always-visible explanation of the upset / divergence badges, shown inside the filter panel.
// On mobile, tapping a tiny badge on a card to reveal its tooltip is not discoverable — this
// spells the meaning out as plain text so users don't have to find and tap the badge.
export default function BadgeLegend() {
  const t = useTranslations();
  return (
    <div className="space-y-1.5 rounded-md border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-600">
      <p className="font-semibold uppercase tracking-wide text-slate-500">{t('matches.legendTitle')}</p>
      <div className="flex items-start gap-2">
        <span className="shrink-0">
          <UpsetPill />
        </span>
        <span>{t('upset.tooltip')}</span>
      </div>
      <div className="flex items-start gap-2">
        <span className="shrink-0">
          <DivergencePill />
        </span>
        <span>{t('divergence.tooltip')}</span>
      </div>
    </div>
  );
}
