'use client';

import { useState, useMemo, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { Exam, Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { Card, ProgressBar, Button, Modal, Input, Textarea, SelectField, SubjectBadge, Badge, ConfirmDialog } from '@/components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, isExamType } from '@/lib/utils';
import {
  examDateForSave,
  examDateInputValue,
  examDayDistance,
  examRepresentsTask,
  examTemporalStatus,
} from '@/lib/exam-status';
import { formatCivilDate } from '@/lib/civil-date';
import { taskDueAt, taskDueDayDistance } from '@/lib/task-status';
import { useCurrentTime } from '@/lib/use-current-time';
import { useHydrated } from '@/lib/use-hydrated';
import { usePlannerStore } from '@/lib/planner/store';
import {
  discardUnownedLegacyStorageValue,
  userScopedStorageKey,
} from '@/lib/user-scoped-storage';
import Link from 'next/link';
import {
  GraduationCap,
  Plus,
  Calendar,
  MapPin,
  Clock,
  Trash2,
  Edit3,
  AlertTriangle,
  ClipboardList,
  X,
} from 'lucide-react';

interface ExamCardProps {
  exam: Exam;
  onEdit: (exam: Exam) => void;
  now: Date;
  timeZone: string;
}

// Strip HTML tags from descriptions (Canvas imports often contain HTML)
function stripHtml(text: string): string {
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) {
    return text
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>\s*<p>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
  return text;
}

function ExamCard({ exam, onEdit, now, timeZone }: ExamCardProps) {
  const { updateExam, deleteExam, subjects } = useAppStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isUpdatingProgress, setIsUpdatingProgress] = useState(false);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const progressUpdateInFlightRef = useRef(false);
  const subject = subjects.find((s) => s.id === exam.subject_id);
  const daysUntil = examDayDistance(exam, now, timeZone);
  const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0;
  const isPast = examTemporalStatus(exam, now, timeZone) === 'past';

  const handleProgressChange = async (value: number) => {
    if (progressUpdateInFlightRef.current) return;
    progressUpdateInFlightRef.current = true;
    setIsUpdatingProgress(true);
    setProgressSaveFailed(false);
    try {
      const saved = await updateExam(exam.id, {
        preparation_progress: Math.min(100, Math.max(0, value)),
      });
      if (!saved) setProgressSaveFailed(true);
    } catch {
      setProgressSaveFailed(true);
    } finally {
      progressUpdateInFlightRef.current = false;
      setIsUpdatingProgress(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -30 }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <Card
        className={cn(
          'group relative overflow-hidden glow-border',
          isUrgent && !isPast && 'border-yellow-500/30',
          isPast && 'opacity-60'
        )}
      >
        {/* Urgency indicator */}
        {isUrgent && !isPast && (
          <motion.div
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 to-orange-500"
          />
        )}

        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'p-2.5 rounded-xl shrink-0',
                  isPast
                    ? 'bg-gray-500/20'
                    : isUrgent
                    ? 'bg-yellow-500/20'
                    : 'bg-indigo-500/20'
                )}
              >
                <GraduationCap
                  className={cn(
                    'w-5 h-5',
                    isPast
                      ? 'text-gray-400'
                      : isUrgent
                      ? 'text-yellow-400'
                      : 'text-indigo-400'
                  )}
                />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground leading-snug">{exam.title}</h3>
                {subject && (
                  <SubjectBadge name={subject.name} color={subject.color} />
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button
                onClick={() => onEdit(exam)}
                aria-label={`Edit ${exam.title}`}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label={`Delete ${exam.title}`}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {exam.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {stripHtml(exam.description)}
            </p>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {formatCivilDate(exam.exam_date, timeZone) || 'Date unavailable'}
            </span>
            {exam.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {exam.location}
              </span>
            )}
            <span
              className={cn(
                'flex items-center gap-1.5',
                isPast
                  ? 'text-gray-400'
                  : isUrgent
                  ? 'text-yellow-400'
                  : daysUntil !== null && daysUntil <= 14
                  ? 'text-orange-400'
                  : 'text-green-400'
              )}
            >
              <Clock className="w-4 h-4" />
              {isPast
                ? 'Past'
                : daysUntil === null
                ? 'Date unavailable'
                : daysUntil === 0
                ? 'Today!'
                : daysUntil === 1
                ? 'Tomorrow'
                : `${daysUntil} days left`}
            </span>
          </div>

          {/* Preparation Progress */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Preparation Progress</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleProgressChange(exam.preparation_progress - 10)}
                  aria-label={`Decrease ${exam.title} preparation by 10 percent`}
                  className="w-6 h-6 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm"
                  disabled={exam.preparation_progress <= 0 || isUpdatingProgress}
                >
                  -
                </button>
                <span className="text-sm font-medium text-foreground w-12 text-center">
                  {exam.preparation_progress}%
                </span>
                <button
                  type="button"
                  onClick={() => handleProgressChange(exam.preparation_progress + 10)}
                  aria-label={`Increase ${exam.title} preparation by 10 percent`}
                  className="w-6 h-6 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm"
                  disabled={exam.preparation_progress >= 100 || isUpdatingProgress}
                >
                  +
                </button>
              </div>
            </div>
            <ProgressBar
              value={exam.preparation_progress}
              max={100}
              showLabel={false}
              shimmer
              color={
                exam.preparation_progress >= 80
                  ? 'green'
                  : exam.preparation_progress >= 50
                  ? 'yellow'
                  : 'red'
              }
            />
            {progressSaveFailed && (
              <p role="alert" className="mt-2 text-xs text-red-400">
                Preparation progress was not saved. Try again.
              </p>
            )}
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Exam"
        description={`Are you sure you want to delete "${exam.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteExam(exam.id)}
      />
    </motion.div>
  );
}

interface ExamFormProps {
  isOpen: boolean;
  onClose: () => void;
  exam?: Exam | null;
  timeZone: string;
}

function ExamForm({ isOpen, onClose, exam, timeZone }: ExamFormProps) {
  const { addExam, updateExam, subjects, user } = useAppStore();

  const [title, setTitle] = useState(exam?.title || '');
  const [description, setDescription] = useState(exam?.description ? stripHtml(exam.description) : '');
  const [examDate, setExamDate] = useState(exam ? examDateInputValue(exam, timeZone) : '');
  const [location, setLocation] = useState(exam?.location || '');
  const [subjectId, setSubjectId] = useState(exam?.subject_id || '');
  const [progress, setProgress] = useState(exam?.preparation_progress?.toString() || '0');
  const [saveError, setSaveError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formSessionRef = useRef(0);

  useEffect(() => {
    formSessionRef.current += 1;
  }, [isOpen, exam?.id]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTitle(exam?.title || '');
      setDescription(exam?.description ? stripHtml(exam.description) : '');
      setExamDate(exam ? examDateInputValue(exam, timeZone) : '');
      setLocation(exam?.location || '');
      setSubjectId(exam?.subject_id || '');
      setProgress(exam?.preparation_progress?.toString() || '0');
      setSaveError('');
    });
    return () => { cancelled = true; };
  }, [exam, isOpen, timeZone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');

    const storedExamDate = examDateForSave(examDate, timeZone, exam);
    if (!storedExamDate) {
      setSaveError('Choose a valid exam date.');
      return;
    }
    setIsSubmitting(true);
    const submitSession = formSessionRef.current;
    const isCurrentSubmission = () => formSessionRef.current === submitSession;

    const examData = {
      user_id: user?.id || '',
      title,
      description: description || null,
      exam_date: storedExamDate,
      location: location || null,
      subject_id: subjectId || null,
      preparation_progress: parseInt(progress) || 0,
    };

    try {
      const saved = exam
        ? await updateExam(exam.id, examData)
        : await addExam({
            ...examData,
            source: 'manual',
            external_id: null,
          });
      if (!isCurrentSubmission()) return;
      if (!saved) {
        setSaveError('Orderly could not save this exam. Your changes are still here—please try again.');
        return;
      }
      closeForm();
    } catch {
      if (isCurrentSubmission()) {
        setSaveError('Orderly could not save this exam. Your changes are still here—please try again.');
      }
    } finally {
      if (isCurrentSubmission()) setIsSubmitting(false);
    }
  };

  function resetForm() {
    setTitle('');
    setDescription('');
    setExamDate('');
    setLocation('');
    setSubjectId('');
    setProgress('0');
    setSaveError('');
    setIsSubmitting(false);
  }

  function closeForm() {
    formSessionRef.current += 1;
    onClose();
    resetForm();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeForm}
      title={exam ? 'Edit Exam' : 'Add New Exam'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Exam Title"
          placeholder="e.g., Calculus Midterm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <Textarea
          label="Description"
          placeholder="Topics covered, notes..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Exam Date"
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            required
          />
          <Input
            label="Location"
            placeholder="Room 301"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Subject"
            options={[
              { value: '', label: 'Select Subject' },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          />
          <Input
            label="Preparation Progress (%)"
            type="number"
            min="0"
            max="100"
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
          />
        </div>

        {saveError && <p role="alert" aria-live="polite" className="text-sm text-red-400">{saveError}</p>}

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={closeForm}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button type="submit" variant="default" disabled={isSubmitting} aria-busy={isSubmitting} className="flex-1">
            {isSubmitting ? 'Saving…' : exam ? 'Update Exam' : 'Add Exam'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Card for exam-type tasks (from tasks list)
function ExamTaskCard({
  task,
  onDismiss,
  now,
  timeZone,
}: {
  task: Task;
  onDismiss: (id: string) => void;
  now: Date;
  timeZone: string;
}) {
  const { subjects } = useAppStore();
  const subject = subjects.find((s) => s.id === task.subject_id);
  const daysUntil = taskDueDayDistance(task, now, timeZone);
  const dueAt = taskDueAt(task, timeZone);
  const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0;
  const isPast = dueAt ? dueAt.getTime() < now.getTime() : false;

  return (
    <motion.div layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className={cn(
        'group relative overflow-hidden',
        isUrgent && !isPast && 'border-yellow-500/30',
        isPast && 'opacity-60'
      )}>
        {isUrgent && !isPast && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 to-orange-500" />
        )}
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn('p-2.5 rounded-xl shrink-0', isPast ? 'bg-gray-500/20' : isUrgent ? 'bg-yellow-500/20' : 'bg-indigo-500/20')}>
                <ClipboardList className={cn('w-5 h-5', isPast ? 'text-gray-400' : isUrgent ? 'text-yellow-400' : 'text-indigo-400')} />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground leading-snug">{task.title}</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {subject && <SubjectBadge name={subject.name} color={subject.color} />}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-indigo-500/30 text-indigo-400">From Tasks</Badge>
                  {task.course_name && (
                    <span className="text-xs text-muted-foreground">{task.course_name}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <Link href="/tasks">
                <Button variant="ghost" size="sm" className="text-xs h-8">
                  View in Tasks
                </Button>
              </Link>
              <button
                onClick={() => onDismiss(task.id)}
                title="Remove from Exams page"
                aria-label={`Remove ${task.title} from Exams`}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {task.due_date && (
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {formatCivilDate(task.due_date, timeZone) || 'Date unavailable'}
              </span>
            )}
            <span className={cn(
              'flex items-center gap-1.5',
              isPast ? 'text-gray-400' : isUrgent ? 'text-yellow-400' : daysUntil !== null && daysUntil <= 14 ? 'text-orange-400' : 'text-green-400'
            )}>
              <Clock className="w-4 h-4" />
              {isPast ? 'Past' : daysUntil === 0 ? 'Today!' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days left`}
            </span>
            <Badge variant={task.status === 'completed' ? 'default' : 'secondary'} className="text-[10px]">
              {task.status === 'completed' ? 'Completed' : task.status === 'in_progress' ? 'In Progress' : 'Pending'}
            </Badge>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

const DISMISSED_EXAM_TASKS_EVENT = 'orderly-dismissed-exam-tasks-changed';

function subscribeToDismissedExamTasks(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(DISMISSED_EXAM_TASKS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(DISMISSED_EXAM_TASKS_EVENT, onStoreChange);
  };
}

function useDismissedExamTaskIds(userId: string | null): Set<string> {
  const getSnapshot = useCallback(() => {
    const storageKey = userScopedStorageKey('dismissedExamTaskIds', userId);
    if (!storageKey) return '[]';
    try {
      return localStorage.getItem(storageKey) || '[]';
    } catch {
      return '[]';
    }
  }, [userId]);
  const serialized = useSyncExternalStore(
    subscribeToDismissedExamTasks,
    getSnapshot,
    () => '[]',
  );
  return useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(serialized);
      return new Set(Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : []);
    } catch {
      return new Set<string>();
    }
  }, [serialized]);
}

export function ExamList() {
  const { exams, tasks, user } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const now = useCurrentTime();
  const timeZone = (user?.id ? plannerUsers[user.id]?.settings.timeZone : null)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const [showForm, setShowForm] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');
  const mounted = useHydrated();
  const userId = user?.id || null;
  const dismissedTaskIds = useDismissedExamTaskIds(userId);

  useEffect(() => {
    discardUnownedLegacyStorageValue(localStorage, 'dismissedExamTaskIds');
  }, []);

  const handleDismissTask = (taskId: string) => {
    const storageKey = userScopedStorageKey('dismissedExamTaskIds', userId);
    if (!storageKey || !userId) return;
    const next = new Set(dismissedTaskIds);
    next.add(taskId);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      window.dispatchEvent(new Event(DISMISSED_EXAM_TASKS_EVENT));
    } catch {}
  };

  // Get exam-type tasks that don't already have a matching exam entry
  const examTypeTasks = useMemo(() => {
    if (!mounted) return [];
    return tasks.filter((t) => {
      if (!t.due_date) return false;
      if (!isExamType(t.title, t.assignment_type)) return false;
      // Imported provider identity is authoritative. The helper applies a
      // tightly constrained fallback for legacy rows that predate external IDs.
      const hasMatchingExam = exams.some((e) => examRepresentsTask(e, t, timeZone));
      if (hasMatchingExam) return false;
      // Exclude dismissed tasks
      if (dismissedTaskIds.has(t.id)) return false;
      return true;
    });
  }, [tasks, exams, mounted, dismissedTaskIds, timeZone]);

  const filteredExams = useMemo(() => {
    if (!mounted) return [];
    let filtered = [...exams];

    if (filter === 'upcoming') {
      filtered = filtered.filter((exam) => examTemporalStatus(exam, now, timeZone) === 'upcoming');
    } else if (filter === 'past') {
      filtered = filtered.filter((exam) => examTemporalStatus(exam, now, timeZone) === 'past');
    }

    filtered.sort((left, right) => {
      const leftDate = examDateInputValue(left, timeZone);
      const rightDate = examDateInputValue(right, timeZone);
      return leftDate.localeCompare(rightDate)
        || new Date(left.exam_date).getTime() - new Date(right.exam_date).getTime();
    });

    return filtered;
  }, [exams, filter, mounted, now, timeZone]);

  const filteredExamTasks = useMemo(() => {
    if (!mounted) return [];
    let filtered = [...examTypeTasks];

    if (filter === 'upcoming') {
      filtered = filtered.filter((task) => {
        const dueAt = taskDueAt(task, timeZone);
        return dueAt ? dueAt.getTime() >= now.getTime() : false;
      });
    } else if (filter === 'past') {
      filtered = filtered.filter((task) => {
        const dueAt = taskDueAt(task, timeZone);
        return dueAt ? dueAt.getTime() < now.getTime() : false;
      });
    }

    filtered.sort((left, right) =>
      (taskDueAt(left, timeZone)?.getTime() || 0)
      - (taskDueAt(right, timeZone)?.getTime() || 0)
    );
    return filtered;
  }, [examTypeTasks, filter, mounted, now, timeZone]);

  const stats = useMemo(() => {
    if (!mounted) return { total: 0, upcoming: 0, thisWeek: 0 };
    const upcomingExamDistances = exams
      .filter((exam) => examTemporalStatus(exam, now, timeZone) === 'upcoming')
      .map((exam) => examDayDistance(exam, now, timeZone));
    const upcomingTaskDistances = examTypeTasks
      .filter((task) => {
        const dueAt = taskDueAt(task, timeZone);
        return dueAt ? dueAt.getTime() >= now.getTime() : false;
      })
      .map((task) => taskDueDayDistance(task, now, timeZone));
    const upcomingDistances = [...upcomingExamDistances, ...upcomingTaskDistances];
    return {
      total: exams.length + examTypeTasks.length,
      upcoming: upcomingDistances.length,
      thisWeek: upcomingDistances.filter((days) => days !== null && days >= 0 && days <= 7).length,
    };
  }, [examTypeTasks, exams, mounted, now, timeZone]);

  const statCards = [
    { icon: GraduationCap, label: 'Total Exams', value: stats.total, iconClass: 'bg-indigo-500/20 text-indigo-500 dark:text-indigo-400', gradient: 'from-indigo-500/10 to-indigo-500/5' },
    { icon: Calendar, label: 'Upcoming', value: stats.upcoming, iconClass: 'bg-blue-500/20 text-blue-500 dark:text-blue-400', gradient: 'from-blue-500/10 to-blue-500/5' },
    { icon: AlertTriangle, label: 'This Week', value: stats.thisWeek, iconClass: 'bg-yellow-500/20 text-yellow-500 dark:text-yellow-400', gradient: 'from-yellow-500/10 to-yellow-500/5' },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              variants={itemVariants}
              whileHover={{ scale: 1.03, y: -2 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className={`bg-gradient-to-br ${stat.gradient} backdrop-blur-xl border border-border rounded-xl p-4 glow-border`}
            >
              <div className="flex items-center gap-3">
                <div className={cn('rounded-lg p-2', stat.iconClass)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground font-display">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-display">Exams</h1>
            <p className="text-sm text-muted-foreground">Track upcoming exams and preparation progress</p>
          </div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button onClick={() => setShowForm(true)} size="sm">
              <Plus className="w-4 h-4" /> Add Exam
            </Button>
          </motion.div>
        </div>

        <div className="mt-5">
          <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-1.5 w-fit mb-5">
            {(['upcoming', 'all', 'past'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'relative px-4 py-2 text-[clamp(0.65rem,1.5vw,0.75rem)] font-medium rounded-lg transition-all capitalize',
                  filter === f ? 'text-white' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {filter === f && (
                  <motion.div
                    layoutId="examFilterIndicator"
                    className="absolute inset-0 bg-indigo-500 rounded-lg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{f}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <AnimatePresence mode="popLayout">
              {filteredExams.length === 0 && filteredExamTasks.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-12">
                  <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity }}
                    className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                    <GraduationCap className="w-8 h-8 text-muted-foreground" />
                  </motion.div>
                  <p className="text-muted-foreground">No exams found</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">Add an exam to start tracking your preparation</p>
                </motion.div>
              ) : (
                <>
                  {filteredExams.map((exam) => (
                    <ExamCard
                      key={exam.id}
                      exam={exam}
                      now={now}
                      timeZone={timeZone}
                      onEdit={(e) => { setEditingExam(e); setShowForm(true); }}
                    />
                  ))}
                  {filteredExamTasks.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 pt-2">
                        <ClipboardList className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-sm font-medium text-muted-foreground">Exam-type Tasks</h3>
                        <Badge variant="secondary" className="text-[10px]">{filteredExamTasks.length}</Badge>
                      </div>
                      {filteredExamTasks.map((task) => (
                        <ExamTaskCard
                          key={task.id}
                          task={task}
                          now={now}
                          timeZone={timeZone}
                          onDismiss={handleDismissTask}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ExamForm
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingExam(null); }}
        exam={editingExam}
        timeZone={timeZone}
      />
    </motion.div>
  );
}
