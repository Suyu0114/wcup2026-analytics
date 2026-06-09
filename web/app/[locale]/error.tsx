'use client';

// Locale-scoped error boundary (§6.6): never a blank screen.
import ErrorCard from '@/components/ErrorCard';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-12">
      <ErrorCard reset={reset} />
    </div>
  );
}
