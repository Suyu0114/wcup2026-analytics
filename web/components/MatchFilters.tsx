'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MatchView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import { displayTeamName } from '@/lib/teamName';
import { useDebounce } from '@/lib/hooks/useDebounce';
import MatchCard from './MatchCard';
import BadgeLegend from './BadgeLegend';

// Client-side filtering of the already-fetched group matches (spec Issue 7): group + date +
// upset + divergence + team search, combined with AND, in local React state (no URL sync). The
// server still does the single fetch; this component only narrows what is shown. On mobile the
// control panel collapses behind a toggle; from sm up it is always visible.

function dateKey(iso: string, tz: string): string {
  // stable, locale-independent key (e.g. "2026-06-11") in the display timezone
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function dateStripLabel(iso: string, locale: string, tz: string): string {
  const d = new Date(iso);
  const md = new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'numeric', day: 'numeric' }).format(d);
  const wd = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: locale === 'zh-TW' ? 'narrow' : 'short',
  }).format(d);
  return locale === 'zh-TW' ? `${md} (${wd})` : `${md} ${wd}`;
}

export default function MatchFilters({
  matches,
  locale,
  tz,
}: {
  matches: MatchView[];
  locale: Locale;
  tz: string;
}) {
  const t = useTranslations();
  const [group, setGroup] = useState('all');
  const [date, setDate] = useState('all');
  const [upsetOnly, setUpsetOnly] = useState(false);
  const [divergenceOnly, setDivergenceOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = useDebounce(query, 250).trim().toLowerCase();

  const groups = useMemo(
    () => [...new Set(matches.map((m) => m.group_label).filter((g): g is string => !!g))].sort(),
    [matches],
  );

  const dates = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matches) {
      const k = dateKey(m.kickoff_utc, tz);
      if (!map.has(k)) map.set(k, dateStripLabel(m.kickoff_utc, locale, tz));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, label]) => ({ key, label }));
  }, [matches, locale, tz]);

  const filtered = useMemo(
    () =>
      matches.filter((m) => {
        if (group !== 'all' && m.group_label !== group) return false;
        if (upsetOnly && !m.model?.upset.tier) return false;
        if (divergenceOnly && !m.divergence?.flag) return false;
        if (date !== 'all' && dateKey(m.kickoff_utc, tz) !== date) return false;
        if (q) {
          const home = displayTeamName(m.home, locale).toLowerCase();
          const away = displayTeamName(m.away, locale).toLowerCase();
          if (!home.includes(q) && !away.includes(q)) return false;
        }
        return true;
      }),
    [matches, group, upsetOnly, divergenceOnly, date, q, locale, tz],
  );

  const chip = (active: boolean) =>
    `rounded px-2.5 py-1 text-sm ${
      active
        ? 'bg-slate-800 text-white'
        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;

  const sectionLabel = 'mr-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {t('matches.showing', { shown: filtered.length, total: matches.length })}
        </span>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className="rounded border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 sm:hidden"
        >
          {t('matches.filtersToggle')}
        </button>
      </div>

      <div
        className={`${filtersOpen ? 'block' : 'hidden'} space-y-3 rounded-lg border border-slate-200 bg-white p-3 sm:block`}
      >
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

        <div className="flex items-center gap-2">
          <span className={sectionLabel}>{t('matches.filterDate')}</span>
          <div className="flex flex-1 gap-1 overflow-x-auto pb-1">
            <button
              type="button"
              className={`${chip(date === 'all')} shrink-0 whitespace-nowrap`}
              onClick={() => setDate('all')}
            >
              {t('matches.filterAll')}
            </button>
            {dates.map((d) => (
              <button
                type="button"
                key={d.key}
                className={`${chip(date === d.key)} shrink-0 whitespace-nowrap`}
                onClick={() => setDate(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={upsetOnly}
              onChange={(e) => setUpsetOnly(e.target.checked)}
            />
            {t('matches.filterUpset')}
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={divergenceOnly}
              onChange={(e) => setDivergenceOnly(e.target.checked)}
            />
            {t('matches.filterDivergence')}
          </label>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('matches.searchCountry')}
            aria-label={t('matches.searchCountry')}
            className="ml-auto w-full rounded border border-slate-300 px-2 py-1 text-sm sm:w-48"
          />
        </div>

        <BadgeLegend />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-500">
          {t('matches.noResults')}
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map((m) => (
            <MatchCard key={m.match_id} match={m} locale={locale} tz={tz} />
          ))}
        </div>
      )}
    </div>
  );
}
