'use client';

import { MainLayout } from '@/components/layout';
import { TaskList } from '@/components/tasks';

export default function TasksPage() {
  return (
    <MainLayout>
      <TaskList />
    </MainLayout>
  );
}
