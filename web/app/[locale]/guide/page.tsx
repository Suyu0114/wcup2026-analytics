import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/lib/routing';
import GuideSection from '@/components/GuideSection';
import OddsConverter from '@/components/OddsConverter';

// Static educational page (no DB). Ch1–3 (model / odds formats / vig); Ch4–5 (EV, bankroll,
// Kelly, calculator walkthrough) land with the P6 value-calculator redesign — see moreBody.
export default async function GuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const points = (key: string): string[] => t.raw(key) as string[];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">{t('guide.title')}</h1>
        <p className="text-slate-600">{t('guide.subtitle')}</p>
      </header>

      <div className="space-y-3">
        <GuideSection title={t('guide.model.title')} summary={t('guide.model.summary')} defaultOpen>
          <ul className="list-disc space-y-1.5 pl-5">
            {points('guide.model.points').map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </GuideSection>

        <GuideSection title={t('guide.oddsFormats.title')} summary={t('guide.oddsFormats.summary')}>
          <ul className="list-disc space-y-1.5 pl-5">
            {points('guide.oddsFormats.points').map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <OddsConverter />
        </GuideSection>

        <GuideSection title={t('guide.vig.title')} summary={t('guide.vig.summary')}>
          <ul className="list-disc space-y-1.5 pl-5">
            {points('guide.vig.points').map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
            <p className="font-medium text-slate-700">{t('guide.vig.exampleTitle')}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
              {points('guide.vig.example').map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </GuideSection>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="font-medium text-slate-800">{t('guide.moreTitle')}</p>
        <p className="mt-1 text-sm text-slate-600">{t('guide.moreBody')}</p>
        <Link href="/value" className="mt-2 inline-block text-sm text-sky-600 hover:underline">
          {t('guide.moreCta')} →
        </Link>
      </div>
    </div>
  );
}
