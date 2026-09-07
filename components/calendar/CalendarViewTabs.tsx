'use client';

import { CalendarClock, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalendarSection = 'tasks' | 'schedule';

export function CalendarViewTabs({ value, onChange }: {
  value: CalendarSection;
  onChange: (value: CalendarSection) => void;
}) {
  return (
    <div className="grid w-full grid-cols-2 rounded-xl border border-border/50 bg-muted/35 p-1 sm:w-auto sm:min-w-[280px]"
      role="tablist" aria-label="Calendar view">
      {([
        { id: 'tasks' as const, label: 'Task Calendar', icon: CalendarDays },
        { id: 'schedule' as const, label: 'Schedule', icon: CalendarClock },
      ]).map(item => {
        const Icon = item.icon;
        const selected = value === item.id;
        return <button key={item.id} type="button" role="tab" aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'tasks' : event.key === 'End' ? 'schedule' : value === 'tasks' ? 'schedule' : 'tasks';
            onChange(next);
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            buttons?.[next === 'tasks' ? 0 : 1]?.focus();
          }}
          className={cn('flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            selected ? 'border-border/50 bg-background text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          <Icon className={cn('h-4 w-4 shrink-0', selected && item.id === 'schedule' && 'text-indigo-500')} />
          {item.label}
        </button>;
      })}
    </div>
  );
}
