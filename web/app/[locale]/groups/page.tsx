import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getGroups } from '@/lib/data';
import { siteTz, formatDateShort } from '@/lib/format';
import type { Locale } from '@/lib/routing';
import GroupTable from '@/components/GroupTable';
import EmptyState from '@/components/EmptyState';

export const revalidate = 1800;

export default async function GroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const data = await getGroups();
  const tz = siteTz(locale);
  const groupKeys = Object.keys(data.groups).sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('groups.title')}</h1>
        <p className="mt-1 text-slate-600">{t('groups.subtitle')}</p>
        {!data.unavailable && data.sim_n != null && (
          <p className="mt-1 text-xs text-slate-400">
            {t('common.simN')}: {data.sim_n.toLocaleString()} · {t('common.modelVersion')}{' '}
            {data.model_version} · {t('common.asOf')} {formatDateShort(data.computed_at, locale, tz)}
          </p>
        )}
      </header>

      {data.unavailable ? (
        <EmptyState message={t('common.dataUnavailable')} />
      ) : groupKeys.length === 0 ? (
        <EmptyState message={t('groups.simEmpty')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groupKeys.map((g) => (
            <GroupTable key={g} group={g} teams={data.groups[g]} locale={locale as Locale} />
          ))}
        </div>
      )}
    </div>
  );
}
