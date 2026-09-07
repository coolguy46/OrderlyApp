import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCalendar } from '../../components/calendar/TaskCalendar';
import { ScheduleCalendar } from '../../components/calendar/ScheduleCalendar';
import { DashboardSchedule } from '../../components/dashboard/DashboardSchedule';

function Harness() {
  const [view, setView] = useState('month');
  return <main style={{ margin: 24 }}>
    <nav style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
      {['month', 'schedule', 'dashboard'].map(v => <button key={v} onClick={() => setView(v)}>Fixture {v}</button>)}
    </nav>
    {view === 'month' ? <TaskCalendar /> : view === 'schedule' ? <ScheduleCalendar /> : <DashboardSchedule />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
