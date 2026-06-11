'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDebounce } from '@/lib/hooks/useDebounce';
import Flag from './Flag';

export interface MatchOption {
  id: string;
  label: string;
  home?: { teamId: string; name: string };
  away?: { teamId: string; name: string };
  group?: string | null;
}

// Searchable match combobox replacing the long native <select> (UX overhaul req #2.7).
// The trigger shows the current pick (flags + names); the panel filters by team name as you
// type. Escape / outside-click close — same listener pattern as InfoPopover. When an option
// lacks home/away (e.g. test fixtures), it falls back to the plain `label`.
export default function MatchPicker({
  options,
  value,
  onChange,
}: {
  options: MatchOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 200);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      [o.home?.name, o.away?.name, o.label].some((s) => s?.toLowerCase().includes(q)),
    );
  }, [options, debounced]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onPointer(e: Event) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded border border-slate-300 px-2 py-1.5 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {selected ? <OptionContent o={selected} /> : <span className="text-slate-400">—</span>}
        </span>
        <span aria-hidden="true" className="shrink-0 text-slate-400">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('value.searchTeam')}
              aria-label={t('value.searchTeam')}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-slate-400">{t('value.noMatchFound')}</li>
            )}
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onClick={() => pick(o.id)}
                  className={`flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-sky-50 ${
                    o.id === value ? 'bg-sky-50/60 font-medium' : ''
                  }`}
                >
                  <OptionContent o={o} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OptionContent({ o }: { o: MatchOption }) {
  const t = useTranslations();
  if (!o.home || !o.away) return <span className="truncate">{o.label}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Flag teamId={o.home.teamId} />
      <span>{o.home.name}</span>
      <span className="text-slate-400">vs</span>
      <Flag teamId={o.away.teamId} />
      <span>{o.away.name}</span>
      {o.group && (
        <span className="text-xs text-slate-500">
          · {t('groups.groupLabel')} {o.group}
        </span>
      )}
    </span>
  );
}
