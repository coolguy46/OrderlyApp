import type { ReactNode } from 'react';
import { Card, CardContent } from './Card';
import { cn } from '@/lib/utils';

// Adapted from ravikatiyar162's Stats Card on 21st.dev (demo 8321).
// Use real Orderly counts/descriptions, never the demo's synthetic trends.
export type StatTone = 'violet' | 'blue' | 'emerald' | 'amber' | 'rose';

interface StatCardProps {
  title: string;
  value: ReactNode;
  icon: ReactNode;
  description?: ReactNode;
  tone?: StatTone;
  className?: string;
}

export function StatCard({ title, value, icon, description, tone = 'violet', className }: StatCardProps) {
  return (
    <Card data-slot="stat-card" data-tone={tone} className={cn('workspace-metric h-full overflow-hidden', className)}>
      <CardContent className="p-3 sm:p-5">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <p className="min-w-0 text-xs font-medium text-muted-foreground">{title}</p>
          <span aria-hidden="true" className="workspace-metric-icon hidden shrink-0 rounded-lg p-2 sm:inline-flex [&>svg]:size-4">{icon}</span>
        </div>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-3xl">{value}</p>
        {description != null && <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground sm:text-xs">{description}</p>}
      </CardContent>
    </Card>
  );
}
