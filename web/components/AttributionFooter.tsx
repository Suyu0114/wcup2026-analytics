import { useTranslations } from 'next-intl';

// Elo CC BY-SA 4.0 attribution + market-efficiency disclaimer — every page (D7 / trap #9 / TU9).
export default function AttributionFooter() {
  const t = useTranslations();
  return (
    <footer className="mt-12 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-xs text-slate-500">
        <p>{t('footer.marketEfficiency')}</p>
        <p>
          {t('footer.attribution')}{' '}
          <a
            className="underline hover:text-slate-700"
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            {t('footer.attributionLinkText')}
          </a>
          {' · '}
          <a className="underline hover:text-slate-700" href="https://www.eloratings.net" target="_blank" rel="noreferrer">
            eloratings.net
          </a>
        </p>
      </div>
    </footer>
  );
}
