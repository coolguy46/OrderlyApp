import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCalendar } from '../../components/calendar/TaskCalendar';
import { ScheduleCalendar } from '../../components/calendar/ScheduleCalendar';
import { DashboardSchedule } from '../../components/dashboard/DashboardSchedule';
import { Planner } from '../../components/planner/Planner';

function Harness() {
  const [view, setView] = useState('month');
  return <main style={{ margin: 24 }}>
    <nav style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
      {['month', 'schedule', 'dashboard', 'assistant'].map(v => <button key={v} onClick={() => setView(v)}>Fixture {v}</button>)}
    </nav>
    {view === 'month' ? <TaskCalendar /> : view === 'schedule' ? <ScheduleCalendar /> : view === 'assistant' ? <Planner /> : <DashboardSchedule />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
