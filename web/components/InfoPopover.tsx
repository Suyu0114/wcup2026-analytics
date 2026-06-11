'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

// Lightweight, zero-dependency term-explanation popover (vig / upset / divergence).
// Desktop: opens on hover. Touch: toggles on tap. Closes on Escape or outside click.
// Opens ABOVE the trigger (bottom-full) so it never covers the odds bars below.
// `children` is the trigger (e.g. a badge pill); without it a small ⓘ glyph is rendered.
// `align` controls which edge the panel hangs from so right-column icons don't overflow.
export default function InfoPopover({
  body,
  title,
  align = 'start',
  children,
}: {
  body: string;
  title?: string;
  align?: 'start' | 'end';
  children?: ReactNode;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onPointer(e: Event) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t('common.moreInfo')}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-help items-center"
      >
        {children ?? (
          <span
            aria-hidden="true"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500"
          >
            i
          </span>
        )}
      </button>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          className={`absolute bottom-full z-20 mb-1 w-64 max-w-[80vw] whitespace-normal rounded-md border border-slate-200 bg-white p-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {title && <span className="mb-1 block font-semibold text-slate-800">{title}</span>}
          {body}
        </span>
      )}
    </span>
  );
}
