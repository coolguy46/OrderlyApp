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
  TrendingUp,
  Search,
  SlidersHorizontal,
  Sparkles,
  ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';

type SortOption = 'due_date' | 'priority' | 'created_at' | 'title';
type FilterOption = 'all' | 'pending' | 'completed';

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

export function TaskList() {
  const { tasks, subjects } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('due_date');
  const [filterBy, setFilterBy] = useState<FilterOption>('pending');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const filteredAndSortedTasks = useMemo(() => {
    let filtered = [...tasks];

    // Filter by status
    if (filterBy === 'pending') {
      filtered = filtered.filter((t) => t.status === 'pending' || t.status === 'in_progress');
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
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
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
  }, [tasks, sortBy, filterBy, filterSubject, searchQuery]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, pending, completed, completionRate };
  }, [tasks]);

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const filterOptions: { key: FilterOption; label: string; icon: typeof ListTodo; count: number }[] = [
    { key: 'all', label: 'All', icon: ListTodo, count: stats.total },
    { key: 'pending', label: 'Active', icon: Clock, count: stats.pending },
    { key: 'completed', label: 'Done', icon: CheckCircle2, count: stats.completed },
  ];

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring' as const, stiffness: 300, damping: 25 }}
        className="flex flex-col gap-1"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <motion.div
                className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25"
                whileHover={{ scale: 1.05, rotate: 5 }}
                whileTap={{ scale: 0.95 }}
              >
                <ListTodo className="w-5 h-5 text-white" />
              </motion.div>
              <motion.div
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-background"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
              <p className="text-sm text-muted-foreground">
                {stats.pending > 0
                  ? `${stats.pending} task${stats.pending !== 1 ? 's' : ''} to complete`
                  : 'All caught up! 🎉'}
              </p>
            </div>
          </div>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Button onClick={() => setShowForm(true)} className="gap-2 shadow-md shadow-primary/20">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Task</span>
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Stats Bar */}
      <motion.div
        initial="hidden" animate="show" variants={containerVariants}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {[
          { label: 'Total', value: stats.total, icon: ListTodo, gradient: 'from-slate-500/15 to-slate-400/5', iconBg: 'bg-slate-500/20', iconColor: 'text-slate-400' },
          { label: 'Active', value: stats.pending, icon: Clock, gradient: 'from-amber-500/15 to-orange-400/5', iconBg: 'bg-amber-500/20', iconColor: 'text-amber-400' },
          { label: 'Done', value: stats.completed, icon: CheckCircle2, gradient: 'from-emerald-500/15 to-green-400/5', iconBg: 'bg-emerald-500/20', iconColor: 'text-emerald-400' },
          { label: 'Rate', value: `${stats.completionRate}%`, icon: TrendingUp, gradient: 'from-indigo-500/15 to-purple-400/5', iconBg: 'bg-indigo-500/20', iconColor: 'text-indigo-400' },
        ].map((stat) => (
          <motion.div key={stat.label} variants={itemVariants}>
            <motion.div
              whileHover={{ scale: 1.03, y: -2 }}
              transition={{ type: 'spring' as const, stiffness: 400, damping: 20 }}
              className={cn(
                'relative overflow-hidden rounded-xl border border-border/50 p-3.5',
                'bg-gradient-to-br backdrop-blur-sm',
                stat.gradient
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn('p-2 rounded-lg', stat.iconBg)}>
                  <stat.icon className={cn('w-4 h-4', stat.iconColor)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold tracking-tight leading-none">{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Search & Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="space-y-3"
      >
        {/* Search + Toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted/30 border-border/50"
            />
            {searchQuery && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                onClick={() => setSearchQuery('')}
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
              className="h-9 w-9 shrink-0"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </Button>
          </motion.div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-muted/40 rounded-xl p-1 border border-border/30">
            {filterOptions.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setFilterBy(filter.key)}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  filterBy === filter.key
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {filterBy === filter.key && (
                  <motion.div
                    layoutId="activeTaskFilter"
                    className="absolute inset-0 bg-primary rounded-lg shadow-sm shadow-primary/25"
                    transition={{ type: 'spring' as const, stiffness: 400, damping: 25 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <filter.icon className="w-3.5 h-3.5" />
                  {filter.label}
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                    filterBy === filter.key
                      ? 'bg-white/20'
                      : 'bg-muted-foreground/15'
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
      <div className="space-y-2.5">
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
                  className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/20"
                  animate={{ y: [0, -6, 0], rotate: [0, 3, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Sparkles className="w-7 h-7 text-indigo-400" />
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
                <TaskCard task={task} onEdit={handleEdit} index={index} />
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
