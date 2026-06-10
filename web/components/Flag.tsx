import { flagCode } from '@/lib/flag';

// Visual aid only (flag-icons SVG — renders consistently on Windows, unlike emoji flags). The
// team name is always shown next to it, so the flag is decorative → aria-hidden keeps it out of
// the accessibility tree.
export default function Flag({ teamId, className = '' }: { teamId: string; className?: string }) {
  return (
    <span
      className={`fi fi-${flagCode(teamId)} rounded-[2px] ${className}`}
      aria-hidden="true"
    />
  );
}
