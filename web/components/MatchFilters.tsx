'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MatchView } from '@/lib/types';
import type { Locale } from '@/lib/routing';
import MatchCard from './MatchCard';

// Client-side filtering of the already-fetched group matches (spec Issue 7): group + date +
// upset, combined with AND, in local React state (no URL sync in v1). The server still does the
// single fetch; this component only narrows what is shown.

function dateKey(iso: string, tz: string): string {
  // stable, locale-independent key (e.g. "2026-06-11") in the display timezone
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function dateLabel(iso: string, locale: string, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(iso));
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

  const groups = useMemo(
    () => [...new Set(matches.map((m) => m.group_label).filter((g): g is string => !!g))].sort(),
    [matches],
  );

  const dates = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matches) {
      const k = dateKey(m.kickoff_utc, tz);
      if (!map.has(k)) map.set(k, dateLabel(m.kickoff_utc, locale, tz));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, label]) => ({ key, label }));
  }, [matches, locale, tz]);

  const filtered = useMemo(
    () =>
      matches.filter((m) => {
        if (group !== 'all' && m.group_label !== group) return false;
        if (upsetOnly && !m.model?.upset.flag) return false;
        if (date !== 'all' && dateKey(m.kickoff_utc, tz) !== date) return false;
        return true;
      }),
    [matches, group, upsetOnly, date, tz],
  );

  const chip = (active: boolean) =>
    `rounded px-2.5 py-1 text-sm ${
      active
        ? 'bg-slate-800 text-white'
        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('matches.filterGroup')}
          </span>
          <button type="button" className={chip(group === 'all')} onClick={() => setGroup('all')}>
            {t('matches.filterAll')}
          </button>
          {groups.map((g) => (
            <button type="button" key={g} className={chip(group === g)} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('matches.filterDate')}
          </span>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="all">{t('matches.allDates')}</option>
            {dates.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={upsetOnly}
            onChange={(e) => setUpsetOnly(e.target.checked)}
          />
          {t('matches.filterUpset')}
        </label>

        <span className="ml-auto text-xs text-slate-400">
          {t('matches.showing', { shown: filtered.length, total: matches.length })}
        </span>
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
