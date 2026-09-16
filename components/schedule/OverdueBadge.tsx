import { TriangleAlert } from 'lucide-react';

/** Text and icon distinguish lateness from a red subject color, without recoloring the task. */
export function OverdueBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-sm bg-red-50 px-1 text-[10px] font-semibold leading-3 text-red-700 dark:bg-red-950/80 dark:text-red-300">
      <TriangleAlert aria-hidden="true" className="h-2.5 w-2.5" />
      <span className="@max-[160px]/schedule-item:sr-only">Overdue</span>
    </span>
  );
}
