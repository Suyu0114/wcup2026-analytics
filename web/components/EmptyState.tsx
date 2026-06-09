// Graceful empty-data state (§6.6). Empty data is NOT an error — never throw for it.
export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
      {message}
    </div>
  );
}
