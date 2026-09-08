import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCalendar } from '../../components/calendar/TaskCalendar';
import { ScheduleCalendar } from '../../components/calendar/ScheduleCalendar';
import { DashboardSchedule } from '../../components/dashboard/DashboardSchedule';
import { Planner } from '../../components/planner/Planner';
import { TaskDetailViewer } from '../../components/tasks/TaskDetailViewer';
import { useAppStore } from './calendar-ui-stores';
import { Toaster } from 'sonner';

function Harness() {
  const [view, setView] = useState('month');
  const [detailOpen, setDetailOpen] = useState(true);
  const detailTask = useAppStore(state => state.tasks.find((task: { id: string }) => task.id === 'layout-canvas-task'));
  return <main style={{ margin: 24 }}>
    <Toaster />
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
      {['month', 'schedule', 'dashboard', 'assistant', 'detail'].map(v => <button key={v} onClick={() => { setView(v); setDetailOpen(true); }}>Fixture {v}</button>)}
    </nav>
    {view === 'month' ? <TaskCalendar /> : view === 'schedule' ? <ScheduleCalendar /> : view === 'assistant' ? <Planner /> : view === 'detail' ? <TaskDetailViewer task={detailTask || null} open={detailOpen} onOpenChange={setDetailOpen} /> : <DashboardSchedule />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
