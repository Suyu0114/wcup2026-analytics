'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FixtureView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { useDebounce } from '@/lib/hooks/useDebounce';
import FixtureRow from './FixtureRow';

// Client-side narrowing of already-fetched group fixtures (mirrors MatchFilters): group +
// status + team search, in local React state (no URL sync). Results are then grouped into
// date sections (FIFA scores-fixtures style). The server still does the single fetch.

type StatusFilter = 'all' | 'finished' | 'upcoming';

function dateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function dateHeading(iso: string, locale: string, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

export default function ScoreFilters({
  fixtures,
  locale,
  tz,
}: {
  fixtures: FixtureView[];
  locale: Locale;
  tz: string;
}) {
  const t = useTranslations();
  const [group, setGroup] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const q = useDebounce(query, 250).trim().toLowerCase();

  const groups = useMemo(
    () => [...new Set(fixtures.map((m) => m.group_label).filter((g): g is string => !!g))].sort(),
    [fixtures],
  );

  const filtered = useMemo(
    () =>
      fixtures.filter((m) => {
        if (group !== 'all' && m.group_label !== group) return false;
        if (statusFilter === 'finished' && m.status !== 'final') return false;
        if (statusFilter === 'upcoming' && m.status === 'final') return false;
        if (q) {
          const home = displayTeamName(m.home, locale).toLowerCase();
          const away = displayTeamName(m.away, locale).toLowerCase();
          if (!home.includes(q) && !away.includes(q)) return false;
        }
        return true;
      }),
    [fixtures, group, statusFilter, q, locale],
  );

  // Group filtered fixtures into date sections (already kickoff-sorted by the server).
  const sections = useMemo(() => {
    const map = new Map<string, FixtureView[]>();
    for (const m of filtered) {
      const k = dateKey(m.kickoff_utc, tz);
      (map.get(k) ?? map.set(k, []).get(k)!).push(m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, tz]);

  const chip = (active: boolean) =>
    `rounded px-2.5 py-1 text-sm ${
      active
        ? 'bg-slate-800 text-white'
        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;
  const sectionLabel = 'mr-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className={sectionLabel}>{t('matches.filterGroup')}</span>
          <button type="button" className={chip(group === 'all')} onClick={() => setGroup('all')}>
            {t('matches.filterAll')}
          </button>
          {groups.map((g) => (
            <button type="button" key={g} className={chip(group === g)} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className={sectionLabel}>{t('results.filterStatus')}</span>
          {(['all', 'finished', 'upcoming'] as const).map((s) => (
            <button type="button" key={s} className={chip(statusFilter === s)} onClick={() => setStatusFilter(s)}>
              {t(`results.status_${s}` as 'results.status_all')}
            </button>
          ))}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('matches.searchCountry')}
            aria-label={t('matches.searchCountry')}
            className="ml-auto w-full rounded border border-slate-300 px-2 py-1 text-sm sm:w-48"
          />
        </div>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-500">
          {t('matches.noResults')}
        </p>
      ) : (
        <div className="space-y-5">
          {sections.map(([key, items]) => (
            <section key={key} className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">
                {dateHeading(items[0].kickoff_utc, locale, tz)}
              </h3>
              <div className="space-y-2">
                {items.map((m) => (
                  <FixtureRow key={m.match_id} fixture={m} locale={locale} tz={tz} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
