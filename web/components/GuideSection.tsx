import type { ReactNode } from 'react';

// Collapsible guide section — native <details>/<summary> (accordion, no JS, a11y-friendly).
// Each section toggles independently.
export default function GuideSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-3">
        <span className="font-semibold text-slate-900">{title}</span>
        {summary && <span className="ml-2 text-sm text-slate-500">{summary}</span>}
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-700">
        {children}
      </div>
    </details>
  );
}
