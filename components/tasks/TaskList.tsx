'use client';

import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';
import { Task, TaskPriority, TaskStatus } from '@/lib/supabase/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
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
  ListFilter,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type SortOption = 'due_date' | 'priority' | 'created_at' | 'title';
type FilterOption = 'pending' | 'completed';

export function TaskList() {
  const { tasks, subjects } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('due_date');
  const [filterBy, setFilterBy] = useState<FilterOption>('pending');
  const [filterSubject, setFilterSubject] = useState<string>('all');

  const filteredAndSortedTasks = useMemo(() => {
    let filtered = [...tasks];

    // Filter by status - pending includes both pending and in_progress
    if (filterBy === 'pending') {
      filtered = filtered.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    } else if (filterBy === 'completed') {
      filtered = filtered.filter((t) => t.status === 'completed');
    }

    // Filter by subject
    if (filterSubject !== 'all') {
      filtered = filtered.filter((t) => t.subject_id === filterSubject);
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'due_date':
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        case 'priority':
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        case 'created_at':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

    return filtered;
  }, [tasks, sortBy, filterBy, filterSubject]);

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
    };
  }, [tasks]);

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const filterOptions = ['pending', 'completed'] as const;

  return (
    <div className="space-y-5">
      {/* Stats - Compact */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.div whileHover={{ scale: 1.01 }}>
          <Card className="bg-card/50 backdrop-blur-xl border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <ListFilter className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-lg font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Total Tasks</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ scale: 1.01 }}>
          <Card className="bg-card/50 backdrop-blur-xl border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Clock className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-bold">{stats.pending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ scale: 1.01 }}>
          <Card className="bg-card/50 backdrop-blur-xl border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className="text-lg font-bold">{stats.completed}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter by Status - Only Pending and Completed */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {filterOptions.map((filter) => (
              <button
                key={filter}
                onClick={() => setFilterBy(filter)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  filterBy === filter
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>

          {/* Filter by Subject */}
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="All Subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due_date">Due Date</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="created_at">Created</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Add Task
        </Button>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {filteredAndSortedTasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-foreground font-medium text-sm">No tasks found</p>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Create a new task to get started
              </p>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowForm(true)}>
                <Plus className="w-3 h-3" />
                New Task
              </Button>
            </motion.div>
          ) : (
            filteredAndSortedTasks.map((task) => (
              <TaskCard key={task.id} task={task} onEdit={handleEdit} />
            ))
          )}
        </AnimatePresence>
      </div>

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
