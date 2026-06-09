'use client';

import { useTranslations } from 'next-intl';

// Error boundary card (§6.6): show message + retry, never a blank screen.
export default function ErrorCard({ reset }: { reset?: () => void }) {
  const t = useTranslations();
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
      <p className="font-medium text-rose-800">{t('common.error')}</p>
      <p className="mt-1 text-sm text-rose-600">{t('common.dataUnavailable')}</p>
      {reset && (
        <button
          onClick={reset}
          className="mt-3 rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
