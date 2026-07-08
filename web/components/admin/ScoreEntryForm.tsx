'use client';

import { useMemo, useState } from 'react';

export interface MatchOption {
  matchId: string;
  group: string | null;
  stage: string; // 'group' | 'r32' | 'r16' | 'qf' | 'sf' | '3rd' | 'final'
  homeName: string;
  awayName: string;
  kickoff: string;
  settled: boolean; // matches.status === 'final' (fd/curated — may lack a manual entry)
  existing: { home: number; away: number; overrideFd: boolean } | null;
}

// Admin is hardcoded zh (no i18n keys needed here).
const STAGE_ZH: Record<string, string> = {
  r32: '32強',
  r16: '16強',
  qf: '八強',
  sf: '四強',
  '3rd': '季軍戰',
  final: '決賽',
};

type Status = 'idle' | 'saving' | 'ok' | 'error';

export default function ScoreEntryForm({ matches }: { matches: MatchOption[] }) {
  const [matchId, setMatchId] = useState('');
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [overrideFd, setOverrideFd] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => matches.find((m) => m.matchId === matchId) ?? null,
    [matches, matchId],
  );

  function onPick(id: string) {
    setMatchId(id);
    setStatus('idle');
    setMessage('');
    const m = matches.find((x) => x.matchId === id);
    setHome(m?.existing ? String(m.existing.home) : '');
    setAway(m?.existing ? String(m.existing.away) : '');
    setOverrideFd(m?.existing?.overrideFd ?? false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hg = Number(home);
    const ag = Number(away);
    if (!matchId || !Number.isInteger(hg) || !Number.isInteger(ag) || hg < 0 || ag < 0) {
      setStatus('error');
      setMessage('請選擇比賽並輸入有效比分。');
      return;
    }
    setStatus('saving');
    setMessage('');
    try {
      const res = await fetch('/api/admin/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, homeGoals: hg, awayGoals: ag, overrideFd }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        recompute?: boolean;
      };
      if (!res.ok) {
        setStatus('error');
        setMessage(
          res.status === 401
            ? '登入已過期，請重新登入。'
            : `${data.error ?? '儲存失敗。'}${data.detail ? `：${data.detail}` : ''}`,
        );
        return;
      }
      setStatus('ok');
      setMessage(
        data.recompute
          ? '已儲存，重算已觸發（約 1–3 分鐘後晉級機率更新）。'
          : '已儲存，但重算未觸發 — 請檢查 GITHUB_DISPATCH_TOKEN 設定。',
      );
    } catch {
      setStatus('error');
      setMessage('儲存失敗，請稍後再試。');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-slate-600">比賽</span>
        <select
          value={matchId}
          onChange={(e) => onPick(e.target.value)}
          className="w-full rounded border border-slate-300 p-3 text-base"
          required
        >
          <option value="">— 選擇比賽 —</option>
          {matches.map((m) => (
            <option key={m.matchId} value={m.matchId}>
              {m.group ? `${m.group}組 · ` : STAGE_ZH[m.stage] ? `${STAGE_ZH[m.stage]} · ` : ''}
              {m.homeName} vs {m.awayName}
              {m.existing
                ? `（已輸入 ${m.existing.home}-${m.existing.away}）`
                : m.settled
                  ? '（已終場）'
                  : ''}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">{selected.homeName}（主）</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={30}
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="w-full rounded border border-slate-300 p-3 text-center text-lg"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">{selected.awayName}（客）</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={30}
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="w-full rounded border border-slate-300 p-3 text-center text-lg"
              required
            />
          </label>
        </div>
      )}

      {selected && selected.stage !== 'group' && (
        <p className="rounded bg-sky-50 px-3 py-2 text-xs text-sky-900">
          淘汰賽請輸入與 football-data 一致的<strong>最終總比分</strong>：含加時進球；PK
          決勝時<strong>連 PK 進球一起加總</strong>（例：1-1 加時後 PK 3-4 → 輸入 4-5）。
          比分不一致會使重算中止。
          {home !== '' && away !== '' && Number(home) === Number(away) && (
            <span className="mt-1 block">
              平手比分無法判定晉級隊：若是 PK 決勝請改輸入含 PK 的總比分；否則晉級隊將由
              football-data 或下一輪對戰自動判定，判定前模擬暫以晉級機率抽樣（過渡狀態，會自癒）。
            </span>
          )}
        </p>
      )}

      {selected && (
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={overrideFd}
            onChange={(e) => setOverrideFd(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            football-data 比分有誤，強制使用此比分
            <span className="block text-xs text-slate-400">
              只有在資料來源比分確定錯誤時才勾選；勾選後重算不會因為來源比分不符而中止。
            </span>
          </span>
        </label>
      )}

      {message && (
        <p className={`text-sm ${status === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'saving' || !matchId}
        className="w-full rounded bg-slate-900 p-3 text-white disabled:opacity-50"
      >
        {status === 'saving' ? '儲存中…' : '儲存比分並重算'}
      </button>
    </form>
  );
}
