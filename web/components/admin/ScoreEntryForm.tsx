'use client';

import { useMemo, useState } from 'react';

export interface MatchOption {
  matchId: string;
  group: string | null;
  homeName: string;
  awayName: string;
  kickoff: string;
  existing: { home: number; away: number; overrideFd: boolean } | null;
}

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
              {m.group ? `${m.group}組 · ` : ''}
              {m.homeName} vs {m.awayName}
              {m.existing ? `（已輸入 ${m.existing.home}-${m.existing.away}）` : ''}
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
