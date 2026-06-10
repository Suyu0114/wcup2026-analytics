import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMatches } from '@/lib/data';
import { displayTeamName } from '@/lib/teamName';
import { Link, type Locale } from '@/lib/routing';
import ValueCalculator, { type MatchOption } from '@/components/ValueCalculator';
import EmptyState from '@/components/EmptyState';

export const revalidate = 1800;

export default async function ValuePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const { matches } = await getMatches();

  const options: MatchOption[] = matches.map((m) => {
    const home = displayTeamName(m.home, locale as Locale);
    const away = displayTeamName(m.away, locale as Locale);
    const grp = m.group_label ? ` · ${t('groups.groupLabel')} ${m.group_label}` : '';
    return { id: m.match_id, label: `${home} vs ${away}${grp}` };
  });

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
        <ValueCalculator matchOptions={options} />
      )}
    </div>
  );
}
