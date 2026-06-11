import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMatches } from '@/lib/data';
import { displayTeamName } from '@/lib/teamName';
import { divergenceList } from '@/lib/divergence';
import { Link, type Locale } from '@/lib/routing';
import ValueCalculator, { type CalculatorDefaults, type MatchOption } from '@/components/ValueCalculator';
import DivergenceList from '@/components/DivergenceList';
import EmptyState from '@/components/EmptyState';

// Reading searchParams (screener prefill, P6 §3.7) makes this page dynamic.
export default async function ValuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ match?: string; market?: string; outcome?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const { matches } = await getMatches();

  const options: MatchOption[] = matches.map((m) => {
    const home = displayTeamName(m.home, locale as Locale);
    const away = displayTeamName(m.away, locale as Locale);
    const grp = m.group_label ? ` · ${t('groups.groupLabel')} ${m.group_label}` : '';
    return {
      id: m.match_id,
      label: `${home} vs ${away}${grp}`,
      home: { teamId: m.home.team_id, name: home },
      away: { teamId: m.away.team_id, name: away },
      group: m.group_label,
    };
  });

  // prefill from the divergence screener links (P6 §3.7); invalid values are ignored
  const defaults: CalculatorDefaults = {
    matchId: sp.match,
    market: sp.market === 'totals' ? 'totals' : sp.market === 'h2h' ? 'h2h' : undefined,
    outcome: sp.outcome,
  };

  const divergence = divergenceList(matches);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('value.title')}</h1>
        <p className="mt-1 text-slate-600">{t('value.subtitle')}</p>
        <Link
          href="/guide"
          className="mt-2 inline-block rounded bg-sky-50 px-3 py-1.5 text-sm text-sky-800 hover:bg-sky-100"
        >
          {t('value.guidePrompt')} →
        </Link>
      </header>

      {options.length === 0 ? (
        <EmptyState message={t('common.dataUnavailable')} />
      ) : (
        <ValueCalculator matchOptions={options} defaults={defaults} />
      )}

      <DivergenceList rows={divergence} locale={locale as Locale} />
    </div>
  );
}
