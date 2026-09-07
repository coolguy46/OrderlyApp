import { createRoot } from 'react-dom/client';
import { Dashboard } from '../../components/dashboard/Dashboard';
import { TaskList } from '../../components/tasks/TaskList';
import { TaskForm } from '../../components/tasks/TaskForm';
import { TaskCalendar } from '../../components/calendar/TaskCalendar';
import { ScheduleCalendar } from '../../components/calendar/ScheduleCalendar';
import { Planner } from '../../components/planner/Planner';
import { GoalList } from '../../components/goals/GoalList';
import { StudySession } from '../../components/study/StudySession';
import { ExamList } from '../../components/exams/ExamList';
import SettingsPage from '../../app/settings/page';
import IntegrationsPage from '../../app/settings/integrations/page';
import { demoEvents, demoTasks } from './tutorial-demo-stores';

const view = new URLSearchParams(window.location.search).get('view') || 'dashboard';
const noop = () => {};
function Demo() {
  return <main data-demo-capture style={{ padding: 24, maxWidth: 1160, margin: '0 auto' }}>
    {view === 'dashboard' && <Dashboard />}
    {view === 'tasks' && <TaskList initialFilter="all" />}
    {view === 'task-editor' && <TaskForm isOpen onClose={noop} task={demoTasks[0] as never} />}
    {view === 'event-editor' && <TaskForm isOpen onClose={noop} initialMode="event" commitment={demoEvents[0] as never} />}
    {view === 'calendar' && <TaskCalendar />}
    {view === 'schedule' && <ScheduleCalendar />}
    {view === 'assistant' && <Planner />}
    {view === 'goals' && <GoalList />}
    {view === 'study' && <StudySession />}
    {view === 'exams' && <ExamList />}
    {view === 'settings' && <SettingsPage />}
    {view === 'canvas-integration' && <IntegrationsPage />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
