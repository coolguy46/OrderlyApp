import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import DashboardPage from '../../app/page';
import TasksPage from '../../app/tasks/page';
import CalendarPage from '../../app/calendar/page';
import AssistantPage from '../../app/planner/page';
import GoalsPage from '../../app/goals/page';
import StudyPage from '../../app/study/page';
import ExamsPage from '../../app/exams/page';
import SettingsPage from '../../app/settings/page';
import IntegrationsPage from '../../app/settings/integrations/page';
import ProfilePage from '../../app/profile/page';
import LandingPage from '../../app/landing/page';
import LoginPage from '../../app/auth/login/page';
import RegisterPage from '../../app/auth/register/page';
import ForgotPasswordPage from '../../app/auth/forgot-password/page';
import ResetPasswordPage from '../../app/auth/reset-password/page';
import SetupPage from '../../app/setup/page';
import PrivacyPage from '../../app/privacy/page';
import TermsPage from '../../app/terms/page';
import './ui-redesign-runtime';

const pages = {
  '/': DashboardPage, '/calendar': CalendarPage, '/planner': AssistantPage,
  '/goals': GoalsPage, '/study': StudyPage, '/exams': ExamsPage, '/settings': SettingsPage,
  '/settings/integrations': IntegrationsPage, '/profile': ProfilePage, '/landing': LandingPage,
  '/auth/login': LoginPage, '/auth/register': RegisterPage, '/auth/forgot-password': ForgotPasswordPage,
  '/auth/reset-password': ResetPasswordPage, '/setup': SetupPage, '/privacy': PrivacyPage, '/terms': TermsPage,
};
async function mount() {
  const Page = pages[window.location.pathname as keyof typeof pages];
  // Resolve the real server page's search-param boundary before mounting its
  // actual MainLayout/TaskList tree in this client-only synthetic harness.
  const content = window.location.pathname === '/tasks'
    ? await TasksPage({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(window.location.search))) })
    : <Page />;
  createRoot(document.getElementById('root')!).render(<><Toaster />{content}</>);
}
void mount();
