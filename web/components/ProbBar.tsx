import { formatPercent } from '@/lib/format';

type Tone = 'model' | 'market' | 'neutral';

const TONE: Record<Tone, string> = {
  model: 'bg-sky-500',
  market: 'bg-emerald-500',
  neutral: 'bg-slate-400',
};

// Pure presentational Tailwind horizontal bar (no chart lib — spec D1).
export default function ProbBar({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: Tone;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-slate-600">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
        <div className={`h-full ${TONE[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right tabular-nums text-slate-700">
        {formatPercent(value)}
      </span>
    </div>
  );
}
