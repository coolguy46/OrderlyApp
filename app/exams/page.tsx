'use client';

import { MainLayout } from '@/components/layout';
import { ExamList } from '@/components/exams';

export default function ExamsPage() {
  return (
    <MainLayout>
      <ExamList />
    </MainLayout>
  );
}
