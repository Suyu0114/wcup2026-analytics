// Display formatting helpers (spec §3.4). Kickoff shown in SITE_TZ + UTC for cross-tz clarity.

export function formatPercent(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export function formatDecimal(d: number, digits = 2): string {
  return d.toFixed(digits);
}

export function siteTz(locale?: string): string {
  if (locale === 'en') {
    return 'America/Toronto';
  }
  return process.env.SITE_TZ || 'Asia/Taipei';
}

export function formatKickoff(iso: string, locale: string, tz: string): { local: string; utc: string } {
  const d = new Date(iso);
  const local = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz,
  }).format(d);
  const utc = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(d);
  return { local, utc };
}

export function formatDateShort(iso: string | null, locale: string, tz: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: tz }).format(new Date(iso));
}
