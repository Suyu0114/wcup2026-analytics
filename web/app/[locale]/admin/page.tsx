import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/adminAuth';
import { getMatches } from '@/lib/data';
import { getManualResults } from '@/lib/adminServer';
import ScoreEntryForm, { type MatchOption } from '@/components/admin/ScoreEntryForm';

export const dynamic = 'force-dynamic';

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(await isAuthed())) redirect(`/${locale}/admin/login`);

  const { matches, unavailable } = await getMatches();
  const manual = await getManualResults();

  const options: MatchOption[] = matches
    .slice()
    .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc))
    .map((m) => ({
      matchId: m.match_id,
      group: m.group_label,
      homeName: m.home.name_zh ?? m.home.name_en,
      awayName: m.away.name_zh ?? m.away.name_en,
      kickoff: m.kickoff_utc,
      existing: manual[m.match_id] ?? null,
    }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">輸入比賽比分</h1>
      <p className="text-sm text-slate-600">
        輸入已確認的終場比分後會自動觸發重算，約 1–3 分鐘後晉級機率更新。
      </p>
      {unavailable ? (
        <p className="text-rose-600">資料庫目前無法連線，稍後再試。</p>
      ) : (
        <ScoreEntryForm matches={options} />
      )}
    </div>
  );
}
