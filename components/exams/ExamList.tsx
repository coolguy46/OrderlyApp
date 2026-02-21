'use client';

import { useState, useMemo, useEffect } from 'react';
import { Exam, Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { Card, CardHeader, ProgressBar, Button, Modal, Input, Textarea, SelectField, SubjectBadge, Badge } from '@/components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate, getDaysUntil, cn, isExamType } from '@/lib/utils';
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
  CheckCircle2,
  BookOpen,
  ClipboardList,
  X,
} from 'lucide-react';

interface ExamCardProps {
  exam: Exam;
  onEdit: (exam: Exam) => void;
}

function ExamCard({ exam, onEdit }: ExamCardProps) {
  const { updateExam, deleteExam, subjects } = useAppStore();
  const subject = subjects.find((s) => s.id === exam.subject_id);
  const daysUntil = getDaysUntil(exam.exam_date);
  const isUrgent = daysUntil <= 7 && daysUntil >= 0;
  const isPast = daysUntil < 0;

  const handleProgressChange = async (value: number) => {
    await updateExam(exam.id, { preparation_progress: Math.min(100, Math.max(0, value)) });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card
        className={cn(
          'group relative overflow-hidden',
          isUrgent && !isPast && 'border-yellow-500/30',
          isPast && 'opacity-60'
        )}
      >
        {/* Urgency indicator */}
        {isUrgent && !isPast && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 to-orange-500" />
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
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => onEdit(exam)}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => deleteExam(exam.id)}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {exam.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {exam.description}
            </p>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {formatDate(exam.exam_date)}
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
                  : daysUntil <= 14
                  ? 'text-orange-400'
                  : 'text-green-400'
              )}
            >
              <Clock className="w-4 h-4" />
              {isPast
                ? 'Past'
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
                  onClick={() => handleProgressChange(exam.preparation_progress - 10)}
                  className="w-6 h-6 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm"
                  disabled={exam.preparation_progress <= 0}
                >
                  -
                </button>
                <span className="text-sm font-medium text-foreground w-12 text-center">
                  {exam.preparation_progress}%
                </span>
                <button
                  onClick={() => handleProgressChange(exam.preparation_progress + 10)}
                  className="w-6 h-6 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm"
                  disabled={exam.preparation_progress >= 100}
                >
                  +
                </button>
              </div>
            </div>
            <ProgressBar
              value={exam.preparation_progress}
              max={100}
              showLabel={false}
              color={
                exam.preparation_progress >= 80
                  ? 'green'
                  : exam.preparation_progress >= 50
                  ? 'yellow'
                  : 'red'
              }
            />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

interface ExamFormProps {
  isOpen: boolean;
  onClose: () => void;
  exam?: Exam | null;
}

function ExamForm({ isOpen, onClose, exam }: ExamFormProps) {
  const { addExam, updateExam, subjects, user } = useAppStore();

  const [title, setTitle] = useState(exam?.title || '');
  const [description, setDescription] = useState(exam?.description || '');
  const [examDate, setExamDate] = useState(
    exam?.exam_date ? new Date(exam.exam_date).toISOString().split('T')[0] : ''
  );
  const [location, setLocation] = useState(exam?.location || '');
  const [subjectId, setSubjectId] = useState(exam?.subject_id || '');
  const [progress, setProgress] = useState(exam?.preparation_progress?.toString() || '0');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const examData = {
      user_id: user?.id || '',
      title,
      description: description || null,
      exam_date: new Date(examDate + 'T00:00:00').toISOString(),
      location: location || null,
      subject_id: subjectId || null,
      preparation_progress: parseInt(progress) || 0,
    };

    if (exam) {
      await updateExam(exam.id, examData);
    } else {
      await addExam(examData);
    }

    onClose();
    resetForm();
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setExamDate('');
    setLocation('');
    setSubjectId('');
    setProgress('0');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        resetForm();
      }}
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

        <div className="grid grid-cols-2 gap-4">
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

        <div className="grid grid-cols-2 gap-4">
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

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onClose();
              resetForm();
            }}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button type="submit" variant="default" className="flex-1">
            {exam ? 'Update Exam' : 'Add Exam'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Card for exam-type tasks (from tasks list)
function ExamTaskCard({ task, onDismiss }: { task: Task; onDismiss: (id: string) => void }) {
  const { subjects } = useAppStore();
  const subject = subjects.find((s) => s.id === task.subject_id);
  const daysUntil = task.due_date ? getDaysUntil(task.due_date) : null;
  const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0;
  const isPast = daysUntil !== null && daysUntil < 0;

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
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Link href="/tasks">
                <Button variant="ghost" size="sm" className="text-xs h-8">
                  View in Tasks
                </Button>
              </Link>
              <button
                onClick={() => onDismiss(task.id)}
                title="Remove from Exams page"
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
                {formatDate(task.due_date)}
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

export function ExamList() {
  const { exams, tasks } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');
  const [mounted, setMounted] = useState(false);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
    // Load dismissed task IDs from localStorage
    const saved = localStorage.getItem('dismissedExamTaskIds');
    if (saved) {
      try { setDismissedTaskIds(new Set(JSON.parse(saved))); } catch {}
    }
  }, []);

  const handleDismissTask = (taskId: string) => {
    setDismissedTaskIds((prev) => {
      const next = new Set(prev);
      next.add(taskId);
      localStorage.setItem('dismissedExamTaskIds', JSON.stringify([...next]));
      return next;
    });
  };

  // Get exam-type tasks that don't already have a matching exam entry
  const examTypeTasks = useMemo(() => {
    if (!mounted) return [];
    return tasks.filter((t) => {
      if (!t.due_date) return false;
      if (!isExamType(t.title, t.assignment_type)) return false;
      // Don't duplicate if there's already an exam with the same title
      const hasMatchingExam = exams.some((e) => e.title === t.title);
      if (hasMatchingExam) return false;
      // Exclude dismissed tasks
      if (dismissedTaskIds.has(t.id)) return false;
      return true;
    });
  }, [tasks, exams, mounted, dismissedTaskIds]);

  const allExamItems = useMemo(() => {
    // Combine real exams + exam-type tasks for stats
    return [...exams.map(e => ({ type: 'exam' as const, date: e.exam_date })), ...examTypeTasks.map(t => ({ type: 'task' as const, date: t.due_date! }))];
  }, [exams, examTypeTasks]);

  const filteredExams = useMemo(() => {
    if (!mounted) return [];
    const now = new Date();
    let filtered = [...exams];

    if (filter === 'upcoming') {
      filtered = filtered.filter((e) => new Date(e.exam_date) >= now);
    } else if (filter === 'past') {
      filtered = filtered.filter((e) => new Date(e.exam_date) < now);
    }

    // Sort by exam date
    filtered.sort((a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime());

    return filtered;
  }, [exams, filter, mounted]);

  const filteredExamTasks = useMemo(() => {
    if (!mounted) return [];
    const now = new Date();
    let filtered = [...examTypeTasks];

    if (filter === 'upcoming') {
      filtered = filtered.filter((t) => new Date(t.due_date!) >= now);
    } else if (filter === 'past') {
      filtered = filtered.filter((t) => new Date(t.due_date!) < now);
    }

    filtered.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
    return filtered;
  }, [examTypeTasks, filter, mounted]);

  const stats = useMemo(() => {
    if (!mounted) return { total: 0, upcoming: 0, thisWeek: 0, avgPrep: 0 };
    const now = new Date();
    const allDates = allExamItems;
    const upcoming = allDates.filter((item) => new Date(item.date) >= now);
    const thisWeek = upcoming.filter((item) => getDaysUntil(item.date) <= 7);
    const avgPrep = exams.length > 0
      ? Math.round(exams.reduce((acc, e) => acc + e.preparation_progress, 0) / exams.length)
      : 0;

    return {
      total: allDates.length,
      upcoming: upcoming.length,
      thisWeek: thisWeek.length,
      avgPrep,
    };
  }, [exams, allExamItems, mounted]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-muted/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <GraduationCap className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Exams</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-muted/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Calendar className="w-5 h-5 text-blue-500 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.upcoming}</p>
              <p className="text-xs text-muted-foreground">Upcoming</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-muted/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-500 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.thisWeek}</p>
              <p className="text-xs text-muted-foreground">This Week</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-muted/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <BookOpen className="w-5 h-5 text-green-500 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.avgPrep}%</p>
              <p className="text-xs text-muted-foreground">Avg. Preparation</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters and Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-1.5">
          {(['upcoming', 'all', 'past'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-4 py-2 text-[clamp(0.65rem,1.5vw,0.75rem)] font-medium rounded-lg transition-all capitalize',
                filter === f
                  ? 'bg-indigo-500 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />
          Add Exam
        </Button>
      </div>

      {/* Exam List */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {filteredExams.length === 0 && filteredExamTasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                <GraduationCap className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No exams found</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Add an exam to start tracking your preparation
              </p>
            </motion.div>
          ) : (
            <>
              {filteredExams.map((exam) => (
                <ExamCard
                  key={exam.id}
                  exam={exam}
                  onEdit={(e) => {
                    setEditingExam(e);
                    setShowForm(true);
                  }}
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
                    <ExamTaskCard key={task.id} task={task} onDismiss={handleDismissTask} />
                  ))}
                </>
              )}
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Exam Form Modal */}
      <ExamForm
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingExam(null);
        }}
        exam={editingExam}
      />
    </div>
  );
}
