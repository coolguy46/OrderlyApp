import { MainLayout } from '@/components/layout';
import { TaskList } from '@/components/tasks';

interface TasksPageProps {
  searchParams: Promise<{ view?: string | string[] }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const query = await searchParams;
  const initialFilter = query.view === 'missing' ? 'missing' : 'pending';

  return (
    <MainLayout>
      <TaskList initialFilter={initialFilter} />
    </MainLayout>
  );
}
