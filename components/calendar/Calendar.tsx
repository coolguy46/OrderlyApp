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
    <div className="workspace-page flex min-h-0 min-w-0 flex-col">
      <div className="workspace-header">
        <div className="min-w-0">
          <p className="workspace-eyebrow">Plan your time</p>
          <h1 className="workspace-title">Calendar</h1>
          <p className="workspace-description">
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
