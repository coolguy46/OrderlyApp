'use client';

import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';
import { Task } from '@/lib/supabase/types';
import { Button } from '@/components/ui/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  ListTodo,
  CheckCircle2,
  Clock,
  Search,
  SlidersHorizontal,
  Sparkles,
  ArrowUpDown,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { isTaskMissingFromPriorDay, taskDueAt } from '@/lib/task-status';
import { useCurrentTime } from '@/lib/use-current-time';
import { usePlannerStore } from '@/lib/planner/store';

type SortOption = 'due_date' | 'priority' | 'created_at' | 'title';
type FilterOption = 'all' | 'pending' | 'missing' | 'completed';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { 
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 }
  }
};

export function TaskList({ initialFilter = 'pending' }: { initialFilter?: FilterOption }) {
  const { tasks, subjects, user } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const now = useCurrentTime();
  const timeZone = (user?.id ? plannerUsers[user.id]?.settings.timeZone : null)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('due_date');
  const [filterBy, setFilterBy] = useState<FilterOption>(initialFilter);
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const filteredAndSortedTasks = useMemo(() => {
    let filtered = [...tasks];

    // Filter by status
    if (filterBy === 'pending') {
      filtered = filtered.filter((t) =>
        (t.status === 'pending' || t.status === 'in_progress')
        && !isTaskMissingFromPriorDay(t, now, timeZone)
      );
    } else if (filterBy === 'missing') {
      filtered = filtered.filter((t) => isTaskMissingFromPriorDay(t, now, timeZone));
    } else if (filterBy === 'completed') {
      filtered = filtered.filter((t) => t.status === 'completed');
    }

    // Filter by subject
    if (filterSubject !== 'all') {
      filtered = filtered.filter((t) => t.subject_id === filterSubject);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.course_name?.toLowerCase().includes(q)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'due_date':
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return (taskDueAt(a, timeZone)?.getTime() || 0) - (taskDueAt(b, timeZone)?.getTime() || 0);
        case 'priority': {
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        case 'created_at':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

    return filtered;
  }, [tasks, sortBy, filterBy, filterSubject, searchQuery, now, timeZone]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const incomplete = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
    const missing = tasks.filter((t) => isTaskMissingFromPriorDay(t, now, timeZone)).length;
    const pending = incomplete - missing;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    return { total, incomplete, pending, missing, completed };
  }, [tasks, now, timeZone]);

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const filterOptions: { key: FilterOption; label: string; icon: typeof ListTodo; count: number }[] = [
    { key: 'all', label: 'All', icon: ListTodo, count: stats.total },
    { key: 'pending', label: 'Active', icon: Clock, count: stats.pending },
    { key: 'missing', label: 'Missing', icon: AlertTriangle, count: stats.missing },
    { key: 'completed', label: 'Done', icon: CheckCircle2, count: stats.completed },
  ];

  return (
    <div className="workspace-page">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring' as const, stiffness: 300, damping: 25 }}
        className="workspace-header"
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-4">
          <div>
            <p className="workspace-eyebrow">Your workspace</p>
            <div>
              <h1 className="workspace-title">Tasks</h1>
              <p className="workspace-description">
                {stats.incomplete > 0
                  ? `${stats.incomplete} task${stats.incomplete !== 1 ? 's' : ''} to complete`
                  : 'All caught up! 🎉'}
              </p>
            </div>
          </div>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              <span>New Task</span>
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Stats Bar */}
      <motion.div
        initial="hidden" animate="show" variants={containerVariants}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
      >
        {[
          { label: 'Total', value: stats.total, icon: ListTodo, iconColor: 'text-muted-foreground' },
          { label: 'Active', value: stats.pending, icon: Clock, iconColor: 'text-amber-600 dark:text-amber-400' },
          { label: 'Missing', value: stats.missing, icon: AlertTriangle, iconColor: 'text-red-600 dark:text-red-400' },
          { label: 'Done', value: stats.completed, icon: CheckCircle2, iconColor: 'text-emerald-600 dark:text-emerald-400' },
        ].map((stat) => (
          <motion.div key={stat.label} variants={itemVariants}>
            <div
              className="workspace-stat"
            >
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="rounded-lg bg-muted/60 p-2">
                  <stat.icon className={cn('w-3.5 h-3.5 sm:w-4 sm:h-4', stat.iconColor)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tracking-tight leading-none tabular-nums">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Search & Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="workspace-panel space-y-4 p-4 sm:p-5"
      >
        {/* Search + Toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              aria-label="Search tasks"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 bg-background"
            />
            {searchQuery && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                onClick={() => setSearchQuery('')}
                aria-label="Clear task search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </motion.button>
            )}
          </div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Toggle task filters"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </Button>
          </motion.div>
        </div>

        {/* Filter Tabs — horizontally scrollable on mobile */}
        <div className="flex items-center justify-between gap-3">
          <div className="workspace-tabs flex max-w-full items-center gap-1 overflow-x-auto">
            {filterOptions.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setFilterBy(filter.key)}
                aria-pressed={filterBy === filter.key}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors',
                  filterBy === filter.key
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {filterBy === filter.key && (
                  <motion.div
                    layoutId="activeTaskFilter"
                    className="absolute inset-0 rounded-lg border border-border bg-card shadow-sm"
                    transition={{ type: 'spring' as const, stiffness: 400, damping: 25 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <filter.icon className="w-3.5 h-3.5" />
                  {filter.label}
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                    filterBy === filter.key
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted-foreground/10'
                  )}>
                    {filter.count}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring' as const, stiffness: 300, damping: 25 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  Sort:
                </div>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                  <SelectTrigger className="w-[130px] h-8 text-xs bg-muted/30 border-border/50">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="due_date">Due Date</SelectItem>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="created_at">Newest</SelectItem>
                    <SelectItem value="title">Title</SelectItem>
                  </SelectContent>
                </Select>

                <div className="w-px h-5 bg-border/50" />

                <Select value={filterSubject} onValueChange={setFilterSubject}>
                  <SelectTrigger className="w-[150px] h-8 text-xs bg-muted/30 border-border/50">
                    <SelectValue placeholder="All Subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Task List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredAndSortedTasks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative"
            >
              <div className="text-center py-16 px-6 rounded-2xl border border-dashed border-border/60 bg-muted/20">
                <motion.div
                  className="w-12 h-12 mx-auto mb-4 rounded-xl bg-primary/10 flex items-center justify-center"
                >
                  <Sparkles className="w-5 h-5 text-primary" />
                </motion.div>
                <p className="text-foreground font-semibold text-base">
                  {searchQuery ? 'No matching tasks' : 'No tasks yet'}
                </p>
                <p className="text-sm text-muted-foreground mt-1.5 mb-5 max-w-[260px] mx-auto">
                  {searchQuery
                    ? 'Try adjusting your search or filters'
                    : 'Create your first task to start organizing your work'
                  }
                </p>
                {!searchQuery && (
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button
                      onClick={() => setShowForm(true)}
                      className="gap-2 shadow-md shadow-primary/20"
                    >
                      <Plus className="w-4 h-4" />
                      Create Task
                    </Button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            filteredAndSortedTasks.map((task, index) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring' as const, stiffness: 300, damping: 24, delay: index * 0.03 }}
              >
                <TaskCard task={task} onEdit={handleEdit} index={index} currentTime={now} timeZone={timeZone} />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Results count */}
      {filteredAndSortedTasks.length > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-xs text-muted-foreground/60 pt-2"
        >
          Showing {filteredAndSortedTasks.length} of {stats.total} tasks
        </motion.p>
      )}

      {/* Task Form Modal */}
      <TaskForm
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingTask(null);
        }}
        task={editingTask}
      />
    </div>
  );
}
