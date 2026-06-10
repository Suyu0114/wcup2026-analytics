import { useTranslations } from 'next-intl';

// Knockout matchups are TBD before the draw (trap #10 / §6.4 / TU4): a data-independent
// placeholder — never a fabricated matchup, never a crash. Stored knockout matches don't
// exist pre-tournament, so this section renders unconditionally.
export default function KnockoutTbd() {
  const t = useTranslations();
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
      <h2 className="text-sm font-semibold text-slate-700">{t('matches.knockoutTbd')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('matches.knockoutTbdDesc')}</p>
    </section>
  );
}
