import { useTranslations } from 'next-intl';
import ProbBar from './ProbBar';
import ExperimentalTag from './ExperimentalTag';
import InfoPopover from './InfoPopover';

interface Triple {
  home: number;
  draw: number;
  away: number;
}

/**
 * D5 / trap #7 core: model 1X2 is ALWAYS shown alongside the market de-vig probabilities.
 * When market is null (no odds), only the model is shown — but with a stronger experimental
 * tag and an explicit "no market" note, and never as a standalone answer.
 */
export default function ModelVsMarket({ model, market }: { model: Triple; market: Triple | null }) {
  const t = useTranslations();
  const labels = { home: t('outcome.home'), draw: t('outcome.draw'), away: t('outcome.away') };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-sky-700">
            {t('matches.modelLabel')}
          </span>
          <ExperimentalTag strong={market === null} />
        </div>
        <div className="space-y-1">
          <ProbBar label={labels.home} value={model.home} tone="model" />
          <ProbBar label={labels.draw} value={model.draw} tone="model" />
          <ProbBar label={labels.away} value={model.away} tone="model" />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          {t('matches.marketLabel')}
          <InfoPopover body={t('matches.vigTooltip')} align="end" />
        </div>
        {market ? (
          <div className="space-y-1">
            <ProbBar label={labels.home} value={market.home} tone="market" />
            <ProbBar label={labels.draw} value={market.draw} tone="market" />
            <ProbBar label={labels.away} value={market.away} tone="market" />
          </div>
        ) : (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{t('matches.noMarket')}</p>
        )}
      </div>
    </div>
  );
}
