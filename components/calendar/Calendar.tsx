'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScheduleCalendar } from './ScheduleCalendar';
import { TaskCalendar } from './TaskCalendar';

type CalendarSection = 'tasks' | 'schedule';

export function Calendar() {
  const [section, setSection] = useState<CalendarSection>('tasks');

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (requestedView === 'schedule' || requestedView === 'tasks') {
      setSection(requestedView);
    }
  }, []);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {section === 'tasks'
              ? 'See every task, assignment, and exam by its deadline.'
              : 'See exactly when your scheduled work fits into the week.'}
          </p>
        </div>

        <div
          className="relative grid w-full grid-cols-2 rounded-xl border border-border/50 bg-muted/35 p-1 sm:w-auto sm:min-w-[320px]"
          role="tablist"
          aria-label="Calendar view"
        >
          {([
            { id: 'tasks' as const, label: 'Task Calendar', icon: CalendarDays },
            { id: 'schedule' as const, label: 'Schedule', icon: CalendarClock },
          ]).map(item => {
            const Icon = item.icon;
            const selected = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSection(item.id)}
                className={cn(
                  'relative z-10 flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors',
                  selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="calendar-section-indicator"
                    className="absolute inset-0 -z-10 rounded-lg border border-border/50 bg-background shadow-sm"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon className={cn('h-4 w-4', selected && item.id === 'schedule' && 'text-indigo-500')} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" className="min-h-0 flex-1">
        {section === 'tasks' ? <TaskCalendar /> : <ScheduleCalendar />}
      </div>
    </div>
  );
}
