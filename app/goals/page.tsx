'use client';

import { MainLayout } from '@/components/layout';
import { GoalList } from '@/components/goals';

export default function GoalsPage() {
  return (
    <MainLayout>
      <GoalList />
    </MainLayout>
  );
}
