'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Subject, Task, TaskPriority, TaskStatus } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Calendar,
  CalendarDays,
  Clock,
  FileText,
  Flag,
  MapPin,
  Palette,
  Plus,
  Repeat,
  Save,
  Sparkles,
  Tag,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import { calculateSuggestedPriority } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useScheduleStore } from '@/lib/schedule/store';
import { usePlannerStore } from '@/lib/planner/store';
import type { CommitmentKind, RecurringCommitmentInput } from '@/lib/planner/types';
import { toast } from 'sonner';
import {
  DEFAULT_SCHEDULE_DURATION_SECONDS,
  formatDurationInput,
  localDateFromIso,
  localDateTimeToIso,
  localTimeFromIso,
  parseDurationInput,
  scheduledEndAt,
} from '@/lib/schedule/selectors';
import { saveExistingTaskInOrder } from '@/lib/task-form-save-sequence';

export type TaskFormMode = 'task' | 'event';

export interface TaskFormProps {
  isOpen: boolean;
  onClose: () => void;
  task?: Task | null;
  commitment?: RecurringCommitmentInput | null;
  initialMode?: TaskFormMode;
  initialDate?: string;
  initialStartTime?: string;
  initialDurationSeconds?: number | null;
  onSaved?: () => void;
}

const SUBJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];
const SUBJECT_COLOR_NAMES: Record<string, string> = {
  '#6366f1': 'indigo', '#8b5cf6': 'violet', '#ec4899': 'pink',
  '#f43f5e': 'rose', '#f97316': 'orange', '#eab308': 'yellow',
  '#22c55e': 'green', '#14b8a6': 'teal', '#06b6d4': 'cyan',
  '#3b82f6': 'blue',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const EVENT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#06b6d4', '#3b82f6'] as const;
const EVENT_KINDS: Array<{ value: Exclude<CommitmentKind, 'school'>; label: string }> = [
  { value: 'class', label: 'Class' },
  { value: 'sports', label: 'Game / Sports' },
  { value: 'work', label: 'Work' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
];

function normalizedClock(value: string | undefined): string {
  return /^\d{2}:\d{2}/.test(value || '') ? (value || '').slice(0, 5) : '';
}

function endClockFromDuration(startTime: string, durationSeconds: number | null | undefined): string {
  if (!/^\d{2}:\d{2}$/.test(startTime)) return '';
  const [hours, minutes] = startTime.split(':').map(Number);
  const durationMinutes = Math.max(1, Math.round((durationSeconds || 60 * 60) / 60));
  const endMinutes = (hours * 60 + minutes + durationMinutes) % (24 * 60);
  return `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
}

function weekdayForLocalDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function newCommitmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `event-${crypto.randomUUID()}`;
  }
  return `event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function commitmentRepeatsWeekly(commitment: RecurringCommitmentInput): boolean {
  // The event creator represents a one-time event by pinning both date bounds
  // to the same day. Every other commitment shape is a repeating series,
  // including older unbounded records that do not have start/end dates.
  return !(commitment.startDate && commitment.endDate === commitment.startDate);
}

export function TaskForm({
  isOpen,
  onClose,
  task,
  commitment,
  initialMode = 'task',
  initialDate = '',
  initialStartTime = '',
  initialDurationSeconds = null,
  onSaved,
}: TaskFormProps) {
  const { addTask, updateTask, deleteTask, completeTask, subjects, addSubject, deleteSubject, user } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const timeZone = (user?.id ? plannerUsers[user.id]?.settings.timeZone : null)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const eventTimeZone = commitment?.timeZone || timeZone;
  const importedDeadlineLocked = Boolean(
    task && (task.source === 'canvas' || task.source === 'google_classroom'),
  );
  const importedDeadlineTime = importedDeadlineLocked && task?.due_date
    ? localTimeFromIso(
        task.due_date,
        timeZone,
      ) || ''
    : '';
  const upsertTaskSchedule = useScheduleStore(state => state.upsertTaskSchedule);
  const removeTaskSchedule = useScheduleStore(state => state.removeTaskSchedule);
  const waitForSchedulePersistence = useScheduleStore(state => state.waitForSchedulePersistence);
  const upsertCommitment = usePlannerStore(state => state.upsertCommitment);
  const removeCommitment = usePlannerStore(state => state.removeCommitment);
  const waitForPlannerPersistence = usePlannerStore(state => state.waitForPlannerPersistence);
  const scheduleEntry = useScheduleStore(state => (
    user?.id && task?.id ? state.entriesByUser[user.id]?.[task.id] || null : null
  ));
  
  const [mode, setMode] = useState<TaskFormMode>(task ? 'task' : commitment ? 'event' : initialMode);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [manualPriority, setManualPriority] = useState(false);
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [subjectId, setSubjectId] = useState('none');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleStartTime, setScheduleStartTime] = useState('');
  const [durationInput, setDurationInput] = useState('');
  const [titleError, setTitleError] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [eventLocation, setEventLocation] = useState('');
  const [eventDate, setEventDate] = useState(initialDate);
  const [eventStartTime, setEventStartTime] = useState(normalizedClock(initialStartTime));
  const [eventEndTime, setEventEndTime] = useState(
    endClockFromDuration(normalizedClock(initialStartTime), initialDurationSeconds),
  );
  const [eventRecurrenceDays, setEventRecurrenceDays] = useState<number[]>([]);
  const [eventKind, setEventKind] = useState<CommitmentKind>('other');
  const [eventColor, setEventColor] = useState<string>(EVENT_COLORS[0]);
  
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [subjectCreateError, setSubjectCreateError] = useState('');
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [subjectSelectOpen, setSubjectSelectOpen] = useState(false);
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);
  const [eventDeleteOpen, setEventDeleteOpen] = useState(false);
  const formSessionRef = useRef(0);

  const resetForm = useCallback(() => {
    const nextStartTime = normalizedClock(initialStartTime);
    setMode(task ? 'task' : commitment ? 'event' : initialMode);
    setTitle('');
    setDescription('');
    setPriority('medium');
    setManualPriority(false);
    setStatus('pending');
    setSubjectId('none');
    setDueDate('');
    setDueTime('');
    setScheduleDate(initialDate);
    setScheduleStartTime(nextStartTime);
    setDurationInput(initialDurationSeconds ? formatDurationInput(initialDurationSeconds) : '');
    setTitleError('');
    setScheduleError('');
    setSaveError('');
    setRecurrence('none');
    setRecurrenceDays([]);
    setEventLocation('');
    setEventDate(initialDate);
    setEventStartTime(nextStartTime);
    setEventEndTime(endClockFromDuration(nextStartTime, initialDurationSeconds));
    setEventRecurrenceDays([]);
    setEventKind('other');
    setEventColor(EVENT_COLORS[0]);
    setShowNewSubject(false);
    setNewSubjectName('');
    setSubjectCreateError('');
    setIsCreatingSubject(false);
    setIsSubmitting(false);
    setSubjectSelectOpen(false);
    setSubjectToDelete(null);
    setEventDeleteOpen(false);
  }, [commitment, initialDate, initialDurationSeconds, initialMode, initialStartTime, task]);

  // Closing/reopening the form (including reopening another record) invalidates
  // every async continuation started by the previous form session.
  useEffect(() => {
    formSessionRef.current += 1;
  }, [commitment?.id, initialDate, initialDurationSeconds, initialMode, initialStartTime, isOpen, task?.id]);

  useEffect(() => {
    if (!manualPriority && dueDate && !task) {
      const suggestedPriority = calculateSuggestedPriority(dueDate);
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setPriority(suggestedPriority);
      });
      return () => { cancelled = true; };
    }
  }, [dueDate, manualPriority, task]);

  const handlePriorityChange = (value: string) => {
    setPriority(value as TaskPriority);
    setManualPriority(true);
  };

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (task) {
        setMode('task');
        setTitle(task.title);
        setDescription(task.description || '');
        setPriority(task.priority);
        setStatus(task.status);
        setSubjectId(task.subject_id || 'none');
        setDueDate(task.due_date
          ? localDateFromIso(task.due_date, timeZone) || ''
          : '');
        setDueTime(task.due_time || '');
        setScheduleDate(scheduleEntry?.scheduledDate || '');
        setScheduleStartTime(scheduleEntry?.startAt
          ? localTimeFromIso(scheduleEntry.startAt, timeZone) || ''
          : '');
        setDurationInput(formatDurationInput(scheduleEntry?.durationSeconds));
        setTitleError('');
        setScheduleError('');
        setSaveError('');
        setRecurrence(task.recurrence || 'none');
        setRecurrenceDays(task.recurrence_days || []);
      } else if (commitment) {
        const repeatsWeekly = commitmentRepeatsWeekly(commitment);
        setMode('event');
        setTitle(commitment.title);
        setDescription(commitment.description || '');
        setEventLocation(commitment.location || '');
        setEventDate(commitment.startDate || initialDate);
        setEventStartTime(normalizedClock(commitment.startTime));
        setEventEndTime(normalizedClock(commitment.endTime));
        setEventRecurrenceDays(repeatsWeekly
          ? [...new Set(commitment.daysOfWeek.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
          : []);
        setEventKind(commitment.kind);
        setEventColor(commitment.color || EVENT_COLORS[0]);
        setTitleError('');
        setScheduleError('');
        setSaveError('');
      } else {
        resetForm();
      }
    });
    return () => { cancelled = true; };
  }, [commitment, initialDate, task, isOpen, scheduleEntry, timeZone, resetForm]);

  const handleCreateSubject = async () => {
    const subjectName = newSubjectName.trim();
    if (!subjectName) {
      setSubjectCreateError('Enter a subject name.');
      return;
    }

    setSubjectCreateError('');
    setIsCreatingSubject(true);
    const submitSession = formSessionRef.current;
    try {
      const createdSubject = await addSubject({
        user_id: user?.id || '',
        name: subjectName,
        color: newSubjectColor,
      });
      if (formSessionRef.current !== submitSession) return;
      if (!createdSubject) {
        setSubjectCreateError('Could not create this subject. Your name and color are still here—please try again.');
        return;
      }

      setSubjectId(createdSubject.id);
      setNewSubjectName('');
      setShowNewSubject(false);
    } catch (error) {
      console.error('Failed to create subject:', error);
      if (formSessionRef.current === submitSession) {
        setSubjectCreateError('Could not create this subject. Your name and color are still here—please try again.');
      }
    } finally {
      if (formSessionRef.current === submitSession) setIsCreatingSubject(false);
    }
  };

  const requestSubjectDelete = (event: React.MouseEvent | React.PointerEvent, subject: Subject) => {
    event.preventDefault();
    event.stopPropagation();
    setSubjectSelectOpen(false);
    setSubjectToDelete(subject);
  };

  const handleDeleteSubject = async () => {
    if (!subjectToDelete) return;

    const deletedSubjectId = subjectToDelete.id;
    await deleteSubject(deletedSubjectId);
    if (subjectId === deletedSubjectId) {
      setSubjectId('none');
    }
    setSubjectToDelete(null);
  };

  const notifySaved = () => {
    try {
      onSaved?.();
    } catch (error) {
      // Saving has already succeeded. A caller refresh callback must not turn a
      // successful save into an error or leave the form open for a duplicate.
      console.error('Task form onSaved callback failed:', error);
    }
  };

  const handleEventSubmit = async () => {
    if (!title.trim()) {
      setTitleError('Enter a title before saving this event.');
      return;
    }
    setTitleError('');

    if (!user?.id) {
      setSaveError('Orderly could not identify your account. Refresh the page and try again.');
      return;
    }
    if (!eventDate) {
      setScheduleError('Choose a date for this event.');
      return;
    }
    if (!eventStartTime || !eventEndTime) {
      setScheduleError('Choose both a start time and an end time.');
      return;
    }
    if (eventStartTime === eventEndTime) {
      setScheduleError('The event start and end time must be different.');
      return;
    }

    const eventWeekday = weekdayForLocalDate(eventDate);
    if (eventWeekday === null || !localDateTimeToIso(eventDate, `${eventStartTime}:00`, eventTimeZone)) {
      setScheduleError('That event date or start time is not valid.');
      return;
    }

    setScheduleError('');
    setSaveError('');
    setIsSubmitting(true);
    const submitSession = formSessionRef.current;
    const isCurrentSubmission = () => formSessionRef.current === submitSession;

    try {
      const repeatsWeekly = eventRecurrenceDays.length > 0;
      const wasRepeatingWeekly = commitment ? commitmentRepeatsWeekly(commitment) : false;
      const commitmentInput: RecurringCommitmentInput = {
        id: commitment?.id || newCommitmentId(),
        title: title.trim(),
        description: description.trim() || null,
        location: eventLocation.trim() || null,
        kind: eventKind,
        daysOfWeek: repeatsWeekly ? eventRecurrenceDays : [eventWeekday],
        startTime: eventStartTime,
        endTime: eventEndTime,
        startDate: eventDate,
        endDate: repeatsWeekly
          ? wasRepeatingWeekly ? commitment?.endDate || null : null
          : eventDate,
        timeZone: eventTimeZone,
        enabled: commitment?.enabled ?? true,
        color: eventColor,
        updatedAt: new Date().toISOString(),
        occurrenceOverrides: commitment?.occurrenceOverrides || {},
      };
      upsertCommitment(user.id, commitmentInput);
      const persisted = await waitForPlannerPersistence(user.id);
      if (!isCurrentSubmission()) return;
      if (!persisted) {
        // Do not leave a local-only event looking successfully saved. Restore
        // the prior event (or remove a newly-created one) while the durable
        // outbox keeps an honest retry state.
        if (commitment) upsertCommitment(user.id, commitment);
        else removeCommitment(user.id, commitmentInput.id);
        setSaveError(`Orderly could not ${commitment ? 'update' : 'create'} this event in the database. Your changes are still here—please try again.`);
        setIsSubmitting(false);
        return;
      }
    } catch (error) {
      console.error('Event submit error:', error);
      if (isCurrentSubmission()) {
        setSaveError(`Orderly could not ${commitment ? 'update' : 'create'} this event. Your changes are still here—please try again.`);
        setIsSubmitting(false);
      }
      return;
    }

    if (!isCurrentSubmission()) return;
    setIsSubmitting(false);
    notifySaved();
    closeForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!task && (commitment || mode === 'event')) {
      await handleEventSubmit();
      return;
    }

    if (!title.trim()) {
      setTitleError('Enter a title before saving this task.');
      return;
    }
    setTitleError('');

    let durationSeconds: number | null = null;
    if (durationInput.trim()) {
      durationSeconds = parseDurationInput(durationInput);
      if (durationSeconds === null) {
        setScheduleError('Enter duration as HH:MM:SS (up to 24:00:00).');
        return;
      }
    }
    if (scheduleStartTime && !scheduleDate) {
      setScheduleError('Choose a schedule date before adding a start time.');
      return;
    }

    const startAt = scheduleStartTime
      ? localDateTimeToIso(scheduleDate, `${scheduleStartTime}:00`, timeZone)
      : null;
    if (scheduleStartTime && !startAt) {
      setScheduleError('That start time is not valid on the selected date.');
      return;
    }
    if (startAt && durationSeconds === null) {
      durationSeconds = DEFAULT_SCHEDULE_DURATION_SECONDS;
    }

    const originalDueDate = task?.due_date
      ? localDateFromIso(task.due_date, timeZone)
      : null;
    const hasUnchangedExternalDeadline = Boolean(
      task?.due_date
      && (task.source === 'canvas' || task.source === 'google_classroom')
      && dueDate === originalDueDate
      && dueTime === (task.due_time || ''),
    );
    const deadlineAt = hasUnchangedExternalDeadline
      ? task?.due_date || null
      : dueDate
        ? localDateTimeToIso(dueDate, `${dueTime || '23:59'}:00`, timeZone)
        : null;
    if (dueDate && !deadlineAt) {
      setScheduleError('That due time is not valid on the selected due date.');
      return;
    }
    const endAt = scheduledEndAt(startAt, durationSeconds);
    const schedulesAfterDeadline = Boolean(
      endAt
      && deadlineAt
      && new Date(endAt).getTime() > new Date(deadlineAt).getTime(),
    );
    // Work sessions may happen after the deadline (especially for imported or
    // overdue work). The deadline remains untouched and the UI warns without
    // blocking the save.
    setScheduleError('');
    setSaveError('');
    setIsSubmitting(true);
    const submitSession = formSessionRef.current;
    const isCurrentSubmission = () => formSessionRef.current === submitSession;

    try {
      const completingFromForm = Boolean(task && task.status !== 'completed' && status === 'completed');
      const taskData = {
        user_id: user?.id || '',
        title: title.trim(),
        description: description || null,
        priority,
        // Completion has side effects (recurrence and statistics), so preserve
        // the current state until the guarded completion action runs below.
        status: completingFromForm && task ? task.status : status,
        subject_id: subjectId === 'none' ? null : subjectId,
        // Store the real deadline instant. Previously this discarded
        // `deadlineAt` and saved local midnight, so a 3 PM task could not
        // become missing when 3 PM passed.
        due_date: deadlineAt,
        due_time: dueTime || null,
        recurrence,
        recurrence_days: recurrence === 'weekly' && recurrenceDays.length > 0 ? recurrenceDays : null,
        completed_at: completingFromForm
          ? task?.completed_at || null
          : status === 'completed'
            ? task?.completed_at || new Date().toISOString()
            : null,
      };

      const persistSchedule = (taskId: string) => {
        if (!user?.id) return;
        const hasScheduleMetadata = Boolean(scheduleDate || startAt || durationSeconds);
        if (hasScheduleMetadata) {
          upsertTaskSchedule(user.id, taskId, {
            scheduledDate: scheduleDate || null,
            startAt,
            durationSeconds,
            recurrence,
            recurrenceDays: recurrence === 'weekly' ? recurrenceDays : null,
            recurrenceEndDate: scheduleEntry?.recurrenceEndDate || null,
          });
        } else {
          removeTaskSchedule(user.id, taskId);
        }
      };

      if (task) {
        const saveResult = await saveExistingTaskInOrder({
          saveDetails: () => updateTask(task.id, taskData),
          persistSchedule: () => persistSchedule(task.id),
          completeTask: () => completeTask(task.id),
          shouldComplete: completingFromForm,
          isCurrent: isCurrentSubmission,
        });
        if (saveResult === 'cancelled') return;
        if (saveResult === 'details-failed') {
          setSaveError('Orderly could not save this task. Your changes are still here—please try again.');
          return;
        }
        if (saveResult === 'completion-failed') {
          setSaveError('The task details were saved, but completion did not finish. Please try the checkbox again.');
          return;
        }
        if (user?.id && !(await waitForSchedulePersistence(user.id, [task.id]))) {
          if (scheduleEntry) {
            upsertTaskSchedule(user.id, task.id, scheduleEntry);
          } else {
            removeTaskSchedule(user.id, task.id);
          }
          setSaveError('The task details were saved, but its planned work time did not reach the database. Your schedule was restored—please try again.');
          return;
        }
      } else {
        const savedTask = await addTask(taskData);
        if (!isCurrentSubmission()) return;
        if (!savedTask) {
          setSaveError('Orderly could not create this task. Your changes are still here—please try again.');
          return;
        }
        persistSchedule(savedTask.id);
        if (user?.id && !(await waitForSchedulePersistence(user.id, [savedTask.id]))) {
          await deleteTask(savedTask.id);
          const rolledBack = !useAppStore.getState().tasks.some(candidate => candidate.id === savedTask.id);
          setSaveError(rolledBack
            ? 'Orderly could not save this task and its planned time together, so nothing was kept. Please try again.'
            : 'The task was created, but its planned time could not be confirmed. Check your task list before trying again.');
          return;
        }
      }
      if (schedulesAfterDeadline && deadlineAt) {
        const formattedDeadline = new Intl.DateTimeFormat('en-US', {
          timeZone,
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(deadlineAt));
        toast.warning('Scheduled after the task deadline', {
          description: `The task remains due ${formattedDeadline}.`,
        });
      }
    } catch (error) {
      console.error('Task submit error:', error);
      if (isCurrentSubmission()) {
        setSaveError('Orderly could not save this task. Your changes are still here—please try again.');
      }
      return;
    } finally {
      if (isCurrentSubmission()) setIsSubmitting(false);
    }

    if (isCurrentSubmission()) {
      notifySaved();
      closeForm();
    }
  };

  function closeForm() {
    formSessionRef.current += 1;
    onClose();
    resetForm();
  }

  const handleDeleteEvent = async () => {
    if (!user?.id || !commitment) return;
    setIsSubmitting(true);
    removeCommitment(user.id, commitment.id);
    const persisted = await waitForPlannerPersistence(user.id);
    if (!persisted) {
      upsertCommitment(user.id, commitment);
      setEventDeleteOpen(false);
      setSaveError('Orderly could not remove this event from the database. It is still on your calendar.');
      setIsSubmitting(false);
      return;
    }
    setEventDeleteOpen(false);
    setIsSubmitting(false);
    notifySaved();
    closeForm();
  };

  const isEventMode = !task && (Boolean(commitment) || mode === 'event');
  const previewTaskDuration = durationInput.trim()
    ? parseDurationInput(durationInput)
    : scheduleStartTime ? DEFAULT_SCHEDULE_DURATION_SECONDS : null;
  const previewTaskStart = scheduleDate && scheduleStartTime
    ? localDateTimeToIso(scheduleDate, `${scheduleStartTime}:00`, timeZone)
    : null;
  const previewTaskEnd = scheduledEndAt(previewTaskStart, previewTaskDuration);
  const previewDeadline = importedDeadlineLocked && task?.due_date
    ? task.due_date
    : dueDate
      ? localDateTimeToIso(dueDate, `${normalizedClock(dueTime) || '23:59'}:00`, timeZone)
      : null;
  const taskEndsAfterDeadline = Boolean(
    previewTaskEnd
    && previewDeadline
    && new Date(previewTaskEnd).getTime() > new Date(previewDeadline).getTime(),
  );
  const formattedPreviewDeadline = taskEndsAfterDeadline && previewDeadline
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(previewDeadline))
    : null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-[540px]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-indigo-500/5 to-transparent">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-xl',
                task ? 'bg-amber-500/15' : isEventMode ? 'bg-cyan-500/15' : 'bg-indigo-500/15'
              )}>
                {task ? (
                  <FileText className="w-5 h-5 text-amber-400" />
                ) : isEventMode ? (
                  <CalendarDays className="h-5 w-5 text-cyan-400" />
                ) : (
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                )}
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">
                  {task ? 'Edit Task' : commitment ? 'Edit Event' : isEventMode ? 'New Event' : 'New Task'}
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {task
                    ? 'Update the details below'
                    : commitment
                      ? 'Update this calendar event and its repeat schedule'
                    : isEventMode
                      ? 'Add a class, game, meeting, or other calendar event'
                      : 'Fill in the details to create a task'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        
        <form onSubmit={handleSubmit} noValidate className="px-6 pb-6 space-y-4">
          {!task && !commitment && (
            <div
              role="tablist"
              aria-label="Create a task or event"
              className="grid grid-cols-2 rounded-xl border border-border/50 bg-muted/25 p-1"
            >
              {(['task', 'event'] as const).map(nextMode => (
                <button
                  key={nextMode}
                  type="button"
                  role="tab"
                  aria-selected={mode === nextMode}
                  onClick={() => {
                    setMode(nextMode);
                    setTitleError('');
                    setScheduleError('');
                    setSaveError('');
                  }}
                  className={cn(
                    'flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors',
                    mode === nextMode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {nextMode === 'task' ? <FileText className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                  {nextMode === 'task' ? 'Task' : 'Event'}
                </button>
              ))}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              Title
            </Label>
            <Input
              id="title"
              placeholder={isEventMode ? 'What is happening?' : 'What needs to be done?'}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError('');
              }}
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? 'task-title-error' : undefined}
              className="h-10 bg-muted/30 border-border/50 focus:bg-background"
            />
            {titleError && (
              <p id="task-title-error" role="alert" className="text-xs text-red-400">
                {titleError}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" />
              Description
              <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">(optional)</span>
            </Label>
            <Textarea
              id="description"
              placeholder="Add more details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none bg-muted/30 border-border/50 focus:bg-background"
            />
          </div>

          {!isEventMode ? (
          <>
          {/* Priority & Status row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-priority" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Flag className="w-3 h-3" />
                Priority
                {!manualPriority && dueDate && (
                  <span className="text-[10px] text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full normal-case tracking-normal font-medium flex items-center gap-0.5">
                    <Zap className="w-2.5 h-2.5" />
                    auto
                  </span>
                )}
              </Label>
              <Select value={priority} onValueChange={handlePriorityChange}>
                <SelectTrigger id="task-priority" className="h-9 bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      High
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Low
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-status" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger id="task-status" className="h-9 bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Subject & Due Date row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={showNewSubject ? 'new-subject-name' : 'task-subject'} className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                Subject
              </Label>
              <AnimatePresence mode="wait">
                {showNewSubject ? (
                  <motion.div
                    key="new-subject"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-2 overflow-hidden"
                  >
                    <Input
                      id="new-subject-name"
                      placeholder="Subject name..."
                      value={newSubjectName}
                      onChange={(e) => {
                        setNewSubjectName(e.target.value);
                        if (subjectCreateError) setSubjectCreateError('');
                      }}
                      aria-invalid={Boolean(subjectCreateError)}
                      aria-describedby={subjectCreateError ? 'new-subject-error' : undefined}
                      className="h-9 bg-muted/30 border-border/50"
                    />
                    <div className="flex items-center gap-1">
                      {SUBJECT_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewSubjectColor(color)}
                          aria-label={`Use ${SUBJECT_COLOR_NAMES[color] || color} for the new subject`}
                          aria-pressed={newSubjectColor === color}
                          className={cn(
                            'w-5 h-5 rounded-full transition-all',
                            newSubjectColor === color ? 'scale-125 ring-2 ring-offset-1 ring-offset-background ring-white/50' : 'hover:scale-110'
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSubjectCreateError('');
                          setShowNewSubject(false);
                        }}
                        disabled={isCreatingSubject}
                        className="flex-1 h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateSubject}
                        disabled={!newSubjectName.trim() || isCreatingSubject}
                        className="flex-1 h-7 text-xs"
                      >
                        {isCreatingSubject ? 'Creating…' : 'Create'}
                      </Button>
                    </div>
                    {subjectCreateError && (
                      <p id="new-subject-error" role="alert" className="text-xs text-red-400">
                        {subjectCreateError}
                      </p>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="subject-select"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-1.5"
                  >
                    <Select open={subjectSelectOpen} onOpenChange={setSubjectSelectOpen} value={subjectId} onValueChange={setSubjectId}>
                      <SelectTrigger id="task-subject" className="h-9 bg-muted/30 border-border/50">
                        <SelectValue placeholder="No Subject" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Subject</SelectItem>
                        {subjects.map((s) => (
                          <div key={s.id} className="relative group/subject">
                            <SelectItem
                              value={s.id}
                              className="pr-16 [&_[data-slot=select-item-indicator]]:right-9"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <div
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: s.color }}
                                />
                                <span className="truncate">{s.name}</span>
                              </div>
                            </SelectItem>
                            <button
                              type="button"
                              aria-label={`Delete ${s.name}`}
                              title={`Delete ${s.name}`}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => requestSubjectDelete(event, s)}
                              className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-70 transition-colors hover:bg-red-500/15 hover:text-red-500 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNewSubject(true)}
                      className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      New Subject
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dueDate" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Due Date
                {(recurrence === 'daily' || recurrence === 'weekly') && (
                  <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">(optional)</span>
                )}
              </Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={importedDeadlineLocked}
                className="h-9 bg-muted/30 border-border/50"
              />
            </div>
          </div>

          {/* Deadline time & recurrence row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dueTime" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Due Time
                <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">(optional)</span>
              </Label>
              <Input
                id="dueTime"
                type="time"
                value={importedDeadlineLocked ? importedDeadlineTime : dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={importedDeadlineLocked}
                className="h-9 bg-muted/30 border-border/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-recurrence" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Repeat className="w-3 h-3" />
                Repeat
              </Label>
              <Select value={recurrence} onValueChange={(v) => { setRecurrence(v as 'none' | 'daily' | 'weekly' | 'monthly'); if (v !== 'weekly') setRecurrenceDays([]); }}>
                <SelectTrigger id="task-recurrence" className="h-9 bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {importedDeadlineLocked && (
            <p className="-mt-1 text-[11px] text-muted-foreground">
              This deadline is kept in sync with {task?.source === 'canvas' ? 'Canvas' : 'the original source'}. You can schedule the work separately below.
            </p>
          )}

          {/* Weekday picker for weekly recurrence */}
          {recurrence === 'weekly' && (
            <div className="space-y-1.5">
              <Label id="task-recurrence-days-label" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Repeat On
                <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">(select days)</span>
              </Label>
              <div className="flex gap-1.5" role="group" aria-labelledby="task-recurrence-days-label">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setRecurrenceDays(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i].sort())}
                    aria-label={`Repeat on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}`}
                    aria-pressed={recurrenceDays.includes(i)}
                    className={cn(
                      'flex-1 h-8 rounded-md text-xs font-medium transition-all',
                      recurrenceDays.includes(i)
                        ? 'bg-indigo-500 text-white shadow-sm'
                        : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 border border-border/50'
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scheduling is intentionally separate from the deadline above. */}
          <div className="space-y-3 rounded-xl border border-border/40 bg-muted/15 p-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Schedule
                <span className="font-normal normal-case tracking-normal text-muted-foreground/50">(optional)</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                Leave the start time blank to keep this task in the untimed shelf. Its deadline does not change.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="scheduleDate" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Calendar className="h-3 w-3" /> Schedule Date
                </Label>
                <Input
                  id="scheduleDate"
                  type="date"
                  value={scheduleDate}
                  onChange={event => {
                    setScheduleDate(event.target.value);
                    setScheduleError('');
                  }}
                  className="h-9 border-border/50 bg-muted/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="scheduleStartTime" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="h-3 w-3" /> Start Time
                </Label>
                <Input
                  id="scheduleStartTime"
                  type="time"
                  value={scheduleStartTime}
                  onChange={event => {
                    const value = event.target.value;
                    setScheduleStartTime(value);
                    if (value && !scheduleDate && dueDate) setScheduleDate(dueDate);
                    setScheduleError('');
                  }}
                  className="h-9 border-border/50 bg-muted/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="duration" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Timer className="h-3 w-3" /> Duration
                </Label>
                <Input
                  id="duration"
                  type="text"
                  inputMode="numeric"
                  placeholder="01:00:00"
                  value={durationInput}
                  aria-invalid={Boolean(scheduleError && durationInput)}
                  onChange={event => {
                    setDurationInput(event.target.value.replace(/[^\d:]/g, ''));
                    setScheduleError('');
                  }}
                  onBlur={() => {
                    const parsed = durationInput.trim() ? parseDurationInput(durationInput) : null;
                    if (parsed) setDurationInput(formatDurationInput(parsed));
                  }}
                  className="h-9 border-border/50 bg-muted/30 font-mono"
                />
              </div>
            </div>

            {scheduleStartTime && !durationInput && (
              <p className="text-[11px] text-muted-foreground">
                No duration entered—this will use 00:30:00.
              </p>
            )}
            {(() => {
              const endTime = previewTaskEnd
                ? localTimeFromIso(previewTaskEnd, timeZone)
                : null;
              if (!previewTaskStart || !endTime) return null;
              const formatClock = (value: string) => {
                const [hours, minutes] = value.split(':').map(Number);
                return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
              };
              return (
                <p className="rounded-md bg-indigo-500/10 px-2.5 py-2 text-[11px] text-indigo-300">
                  Scheduled {formatClock(scheduleStartTime)}–{formatClock(endTime)} on {scheduleDate}
                </p>
              );
            })()}
            {taskEndsAfterDeadline && (
              <p role="status" className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
                This work session ends after the {formattedPreviewDeadline} deadline. You can still schedule it; the original due date will not change.
              </p>
            )}
            {scheduleError && (
              <p role="alert" className="text-xs text-red-400">{scheduleError}</p>
            )}
            {saveError && (
              <p role="alert" aria-live="polite" className="text-xs text-red-400">{saveError}</p>
            )}
          </div>
          </>
          ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="event-location" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3" />
                Location
                <span className="font-normal normal-case tracking-normal text-muted-foreground/50">(optional)</span>
              </Label>
              <Input
                id="event-location"
                value={eventLocation}
                onChange={event => setEventLocation(event.target.value)}
                placeholder="Gym, Room 204, online..."
                className="h-9 border-border/50 bg-muted/30"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Calendar className="h-3 w-3" /> Date
                </Label>
                <Input
                  id="event-date"
                  type="date"
                  value={eventDate}
                  onChange={event => {
                    setEventDate(event.target.value);
                    setScheduleError('');
                  }}
                  aria-invalid={Boolean(scheduleError && !eventDate)}
                  className="h-9 border-border/50 bg-muted/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-start-time" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="h-3 w-3" /> Start
                </Label>
                <Input
                  id="event-start-time"
                  type="time"
                  value={eventStartTime}
                  onChange={event => {
                    const value = event.target.value;
                    setEventStartTime(value);
                    if (value && !eventEndTime) setEventEndTime(endClockFromDuration(value, initialDurationSeconds));
                    setScheduleError('');
                  }}
                  className="h-9 border-border/50 bg-muted/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-end-time" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="h-3 w-3" /> End
                </Label>
                <Input
                  id="event-end-time"
                  type="time"
                  value={eventEndTime}
                  onChange={event => {
                    setEventEndTime(event.target.value);
                    setScheduleError('');
                  }}
                  className="h-9 border-border/50 bg-muted/30"
                />
              </div>
            </div>

            {eventStartTime && eventEndTime && eventEndTime < eventStartTime && (
              <p className="-mt-2 text-[11px] text-muted-foreground">This event ends the next day.</p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-kind" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Tag className="h-3 w-3" /> Event Type
                </Label>
                <Select
                  value={eventKind}
                  onValueChange={value => setEventKind(value as CommitmentKind)}
                >
                  <SelectTrigger id="event-kind" className="h-9 border-border/50 bg-muted/30">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eventKind === 'school' && (
                      <SelectItem value="school" disabled>School Day (managed in Settings)</SelectItem>
                    )}
                    {EVENT_KINDS.map(kind => (
                      <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label id="event-color-label" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Palette className="h-3 w-3" /> Color
                </Label>
                <div className="flex h-9 items-center justify-between rounded-md border border-border/50 bg-muted/30 px-2" role="group" aria-labelledby="event-color-label">
                  {!EVENT_COLORS.includes(eventColor as typeof EVENT_COLORS[number]) && (
                    <button
                      type="button"
                      aria-label="Keep the current custom color for this event"
                      aria-pressed="true"
                      className="h-5 w-5 scale-110 rounded-full ring-2 ring-white/60 ring-offset-2 ring-offset-background"
                      style={{ backgroundColor: eventColor }}
                    />
                  )}
                  {EVENT_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Use ${SUBJECT_COLOR_NAMES[color] || color} for this event`}
                      aria-pressed={eventColor === color}
                      onClick={() => setEventColor(color)}
                      className={cn(
                        'h-5 w-5 rounded-full transition-transform hover:scale-110',
                        eventColor === color && 'scale-110 ring-2 ring-white/60 ring-offset-2 ring-offset-background',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 rounded-xl border border-border/40 bg-muted/15 p-3">
              <Label id="event-recurrence-days-label" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Repeat className="h-3 w-3" /> Repeat Weekly
                <span className="font-normal normal-case tracking-normal text-muted-foreground/50">(optional)</span>
              </Label>
              <div className="flex gap-1.5" role="group" aria-labelledby="event-recurrence-days-label">
                {WEEKDAYS.map((day, index) => (
                  <button
                    key={day}
                    type="button"
                    aria-label={`Repeat on ${WEEKDAY_NAMES[index]}`}
                    aria-pressed={eventRecurrenceDays.includes(index)}
                    onClick={() => setEventRecurrenceDays(previous => previous.includes(index)
                      ? previous.filter(value => value !== index)
                      : [...previous, index].sort())}
                    className={cn(
                      'h-8 flex-1 rounded-md text-xs font-medium transition-all',
                      eventRecurrenceDays.includes(index)
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'border border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                Leave every day unselected for a one-time event. Select days to repeat weekly starting on {eventDate || 'the event date'}.
              </p>
            </div>

            {scheduleError && <p role="alert" className="text-xs text-red-400">{scheduleError}</p>}
            {saveError && (
              <p role="alert" aria-live="polite" className="text-xs text-red-400">{saveError}</p>
            )}
          </>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-3 border-t border-border/30">
            {commitment && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setEventDeleteOpen(true)}
                disabled={isSubmitting}
                className="h-10 gap-1.5 border-red-500/30 px-3 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={closeForm}
              className="flex-1 h-10"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="flex-1 h-10 gap-1.5 shadow-md shadow-primary/20">
              {task ? (
                <>
                  <Save className="w-4 h-4" />
                  {isSubmitting ? 'Saving…' : 'Update Task'}
                </>
              ) : commitment ? (
                <>
                  <Save className="h-4 w-4" />
                  {isSubmitting ? 'Saving…' : 'Update Event'}
                </>
              ) : isEventMode ? (
                <>
                  <CalendarDays className="h-4 w-4" />
                  {isSubmitting ? 'Saving…' : 'Create Event'}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  {isSubmitting ? 'Saving…' : 'Create Task'}
                </>
              )}
            </Button>
          </div>
        </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={subjectToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSubjectToDelete(null);
        }}
        title="Delete Subject"
        description={subjectToDelete
          ? `Are you sure you want to delete "${subjectToDelete.name}"? Tasks and exams using it will remain, but their subject will be cleared.`
          : ''}
        confirmLabel="Delete Subject"
        variant="danger"
        onConfirm={handleDeleteSubject}
      />

      <ConfirmDialog
        open={eventDeleteOpen}
        onOpenChange={setEventDeleteOpen}
        title="Remove Event"
        description={commitment
          ? `Remove “${commitment.title}”${commitmentRepeatsWeekly(commitment) ? ' and every occurrence in this repeating series' : ''} from your calendar?`
          : ''}
        confirmLabel="Remove Event"
        variant="danger"
        onConfirm={handleDeleteEvent}
      />
    </>
  );
}
