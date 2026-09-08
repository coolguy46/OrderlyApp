/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic browser-only fixture. */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import SettingsPage from '../../app/settings/page';
import { GoalList } from '../../components/goals/GoalList';
import { ExamList } from '../../components/exams/ExamList';
import { AppReminders } from '../../components/layout/AppReminders';
import { Profile } from '../../components/social/Profile';
import { controls, useAppStore, owner, saveFixture } from './features-ui-runtime';

function Fixture() {
  const [view, setView] = useState('settings');
  useEffect(() => {
    (window as any).featuresFixture = { controls, state: useAppStore.getState, show: setView,
      switchUser: () => useAppStore.setState({ user: { id: 'feature-test-jamie', full_name: 'Jamie Lee', email: 'jamie@example.invalid' } }),
      taskDueSoon: () => saveFixture({ tasks: [{ id: 'reminder', user_id: owner, title: 'Due soon synthetic task', status: 'pending', source: 'canvas', due_date: new Date(Date.now() + 15 * 60_000).toISOString() }] }),
    };
  }, []);
  return <><Toaster /><div style={{ maxWidth: 1000, margin: 'auto', padding: 16 }}>
    {view === 'settings' ? <SettingsPage /> : view === 'goals' ? <GoalList /> : view === 'exams' ? <ExamList /> : view === 'profile' ? <Profile /> : <AppReminders />}
  </div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
