'use client';

import { useEffect, useState } from 'react';
import { CalendarViewTabs, type CalendarSection } from './CalendarViewTabs';
import { ScheduleCalendar } from './ScheduleCalendar';
import { TaskCalendar } from './TaskCalendar';

export function Calendar() {
  const [section, setSection] = useState<CalendarSection>('tasks');

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (requestedView !== 'schedule' && requestedView !== 'tasks') return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSection(requestedView);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {section === 'tasks'
              ? 'Your deadlines, tasks, and events.'
              : 'Make time for your tasks and events.'}
          </p>
        </div>

        <CalendarViewTabs value={section} onChange={setSection} />
      </div>

      <div role="tabpanel" className="min-h-0 flex-1">
        {section === 'tasks' ? <TaskCalendar /> : <ScheduleCalendar />}
      </div>
    </div>
  );
}
