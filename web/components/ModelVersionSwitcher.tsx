'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/lib/routing';
import { MODEL_VERSIONS, MODEL_VERSION, resolveModelVersion } from '@/lib/constants';

// Global model-version switcher (P10 §4.2). URL-driven (?v=dc-v1.1) so the server
// component re-fetches the chosen version's predictions; default = latest (no ?v).
// MatchFilters is a styling precedent only (it uses local state); navigation here is
// URL-based and MERGES existing params (e.g. /value's ?match) instead of clobbering.
export default function ModelVersionSwitcher({ current }: { current?: string }) {
  const t = useTranslations('modelVersion');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = resolveModelVersion(current);

  function select(id: string) {
    if (id === active) return;
    // copy every existing param except `v`, then add `v` only for non-default versions
    const query: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== 'v') query[key] = value;
    });
    if (id !== MODEL_VERSION) query.v = id;
    // shallow replace (scroll:false) keeps the page from jumping to the top
    router.replace({ pathname, query }, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('label')}>
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('label')}
      </span>
      {MODEL_VERSIONS.map((v) => {
        const isActive = v.id === active;
        return (
          <button
            type="button"
            key={v.id}
            onClick={() => select(v.id)}
            aria-pressed={isActive}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              isActive
                ? 'bg-slate-900 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t(v.i18nKey)}
          </button>
        );
      })}
    </div>
  );
}
