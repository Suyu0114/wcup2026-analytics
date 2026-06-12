'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

export default function AdminLoginPage() {
  const router = useRouter();
  const locale = useLocale();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? '密碼錯誤' : '登入失敗，請稍後再試');
        return;
      }
      router.replace(`/${locale}/admin`);
      router.refresh();
    } catch {
      setError('登入失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-xl font-bold">管理員登入</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密碼"
          className="w-full rounded border border-slate-300 p-3 text-base"
          required
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded bg-slate-900 p-3 text-white disabled:opacity-50"
        >
          {loading ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  );
}
