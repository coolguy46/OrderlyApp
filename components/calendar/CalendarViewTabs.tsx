'use client';

import { CalendarClock, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalendarSection = 'tasks' | 'schedule';

export function CalendarViewTabs({ value, onChange }: {
  value: CalendarSection;
  onChange: (value: CalendarSection) => void;
}) {
  return (
    <div className="workspace-tabs grid w-full shrink-0 grid-cols-2 sm:w-auto sm:min-w-[280px]"
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
          className={cn('flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            selected ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground')}>
          <Icon className={cn('h-4 w-4 shrink-0', selected && 'text-primary')} />
          {item.label}
        </button>;
      })}
    </div>
  );
}
