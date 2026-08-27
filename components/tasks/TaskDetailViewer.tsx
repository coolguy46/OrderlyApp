'use client';

import { useState } from 'react';
import { Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Badge,
} from '@/components/ui';
import { SubjectBadge } from '@/components/ui';
import { formatDate, cn, isExamType } from '@/lib/utils';
import { externalHtmlToPlainText, safeExternalUrl } from '@/lib/safe-content';
import { isTaskMissing, taskDueDayDistance } from '@/lib/task-status';
import { useCurrentTime } from '@/lib/use-current-time';
import { useScheduleStore } from '@/lib/schedule/store';
import { usePlannerStore } from '@/lib/planner/store';
import { formatDurationInput, formatIsoTime, scheduledEndAt, selectScheduleEntry } from '@/lib/schedule/selectors';
import type { ScheduleOccurrence } from '@/lib/schedule/types';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  Calendar,
  Clock,
  ExternalLink,
  Tag,
  CheckCircle2,
  Play,
  GraduationCap,
  AlertTriangle,
  Edit3,
  Zap,
  ArrowUpRight,
  Repeat,
} from 'lucide-react';

interface TaskDetailViewerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (task: Task) => void;
  scheduleOccurrence?: ScheduleOccurrence | null;
}

export function TaskDetailViewer({ task, open, onOpenChange, onEdit, scheduleOccurrence }: TaskDetailViewerProps) {
  const { subjects, completeTask, updateTask } = useAppStore();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const scheduleEntry = useScheduleStore((state) =>
    selectScheduleEntry(state.entriesByUser, task?.user_id, task?.id)
  );
  const plannerUsers = usePlannerStore(state => state.users);
  const now = useCurrentTime();
  
  if (!task) return null;
  
  const subject = subjects.find((s) => s.id === task.subject_id);
  const timeZone = plannerUsers[task.user_id]?.settings.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const daysUntil = taskDueDayDistance(task, now, timeZone);
  const isCompleted = task.status === 'completed';
  const isOverdue = isTaskMissing(task, now, timeZone);
  const displayPriority = isOverdue ? 'high' : task.priority;
  const isExamTask = isExamType(task.title, task.assignment_type);
  const isInProgress = task.status === 'in_progress';
  const isRecurring = task.recurrence && task.recurrence !== 'none';

  const formatTime = (time: string) => {
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m} ${ampm}`;
  };

  const formatZonedDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDate(value);
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  const handleComplete = async () => {
    if (isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      const success = isCompleted
        ? await updateTask(task.id, { status: 'pending', completed_at: null })
        : await completeTask(task.id);
      if (success) onOpenChange(false);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleStartProgress = async () => {
    await updateTask(task.id, { status: 'in_progress' });
  };

  // Priority config
  const priorityConfig = {
    high: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/20', label: 'High Priority', icon: AlertTriangle },
    medium: { color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/20', label: 'Medium Priority', icon: Clock },
    low: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/20', label: 'Low Priority', icon: CheckCircle2 },
  };

  const pConfig = priorityConfig[displayPriority];

  // Source badge
  const getSourceInfo = () => {
    switch (task.source) {
      case 'canvas': return { label: 'Canvas', className: 'bg-orange-500/15 text-orange-400 border-orange-500/20' };
      case 'google_classroom': return { label: 'Imported LMS', className: 'bg-blue-500/15 text-blue-400 border-blue-500/20' };
      default: return null;
    }
  };
  const sourceInfo = getSourceInfo();
  const externalUrl = safeExternalUrl(task.external_url);

  // Due date display
  const getDueDisplay = () => {
    if (!task.due_date || daysUntil === null) return null;
    if (isCompleted) return { text: 'Completed', sub: formatZonedDate(task.due_date), urgent: false, warning: false };
    if (isOverdue) {
      return {
        text: daysUntil < 0 ? `${Math.abs(daysUntil)} days overdue` : 'Overdue',
        sub: formatZonedDate(task.due_date),
        urgent: true,
        warning: false,
      };
    }
    if (daysUntil === 0) return { text: 'Due Today', sub: formatZonedDate(task.due_date), urgent: false, warning: true };
    if (daysUntil === 1) return { text: 'Due Tomorrow', sub: formatZonedDate(task.due_date), urgent: false, warning: true };
    if (daysUntil <= 3) return { text: `${daysUntil} days left`, sub: formatZonedDate(task.due_date), urgent: false, warning: true };
    return { text: formatZonedDate(task.due_date), sub: `${daysUntil} days left`, urgent: false, warning: false };
  };
  const dueDisplay = getDueDisplay();
  const scheduledStartAt = scheduleOccurrence
    ? scheduleOccurrence.startAt
    : scheduleEntry?.startAt || null;
  const scheduledDuration = scheduleOccurrence
    ? scheduleOccurrence.durationSeconds
    : scheduleEntry?.durationSeconds || null;
  const scheduledEnd = scheduledStartAt
    ? scheduledEndAt(scheduledStartAt, scheduledDuration)
    : null;
  const scheduledStartLabel = scheduledStartAt
    ? formatIsoTime(scheduledStartAt, timeZone)
    : null;
  const scheduledEndLabel = scheduledEnd
    ? formatIsoTime(scheduledEnd, timeZone)
    : null;
  const scheduledDate = scheduleOccurrence?.date || scheduleEntry?.scheduledDate || null;
  const scheduledDateLabel = scheduledDate
    ? format(new Date(`${scheduledDate}T12:00:00`), 'EEEE, MMM d')
    : null;

  // Format description
  const formatDescription = (description: string) => {
    const decodedText = externalHtmlToPlainText(description);
    if (!decodedText) return null;

    return (
      <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
        {decodedText}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-2xl sm:overflow-hidden flex flex-col"
        // The shared dialog adds `sm:max-h-none`, whose generated CSS can win
        // over an arbitrary Tailwind max-height class. An inline cap guarantees
        // that long Canvas descriptions stay inside the viewport and scroll.
        style={{ maxHeight: 'min(90dvh, 900px)' }}
      >
        {/* Header with gradient accent */}
        <div className={cn(
          'relative shrink-0 px-6 pt-6 pb-4',
          isOverdue && 'bg-gradient-to-b from-red-500/5 to-transparent',
          isInProgress && !isOverdue && 'bg-gradient-to-b from-indigo-500/5 to-transparent',
          isCompleted && 'bg-gradient-to-b from-emerald-500/5 to-transparent'
        )}>
          <DialogHeader className="space-y-3">
            <div className="flex items-start gap-3 pr-8">
              {/* Status icon */}
              <div className={cn(
                'mt-0.5 shrink-0 p-2 rounded-lg',
                isCompleted ? 'bg-emerald-500/15' :
                isOverdue ? 'bg-red-500/15' :
                isInProgress ? 'bg-indigo-500/15' :
                'bg-muted/50'
              )}>
                {isCompleted ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : isOverdue ? (
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                ) : isInProgress ? (
                  <Zap className="w-5 h-5 text-indigo-400" />
                ) : (
                  <Clock className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold leading-snug break-words">
                  {task.title}
                </DialogTitle>
                {task.course_name && (
                  <p className="text-sm text-muted-foreground mt-0.5">{task.course_name}</p>
                )}
              </div>
            </div>

            {/* Tags row */}
            <div className="flex items-center gap-1.5 flex-wrap pl-[44px]">
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border',
                pConfig.bg, pConfig.color, pConfig.border
              )}>
                <pConfig.icon className="w-3 h-3" />
                {pConfig.label}
              </span>
              
              {isInProgress && !isCompleted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                  <Zap className="w-3 h-3" />
                  In Progress
                </span>
              )}
              
              {isCompleted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" />
                  Completed
                </span>
              )}
              
              {isOverdue && !isCompleted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/20">
                  <AlertTriangle className="w-3 h-3" />
                  Overdue
                </span>
              )}

              {subject && <SubjectBadge name={subject.name} color={subject.color} />}

              {sourceInfo && (
                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0.5', sourceInfo.className)}>
                  {sourceInfo.label}
                </Badge>
              )}

              {isRecurring && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                  <Repeat className="w-3 h-3" />
                  {task.recurrence === 'daily' ? 'Daily' : task.recurrence === 'weekly' ? (task.recurrence_days?.length ? `Weekly (${task.recurrence_days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')})` : 'Weekly') : 'Monthly'}
                </span>
              )}
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="flex-1 -mt-1 min-h-0 overflow-y-auto overscroll-contain px-6 touch-pan-y [-webkit-overflow-scrolling:touch]">
          <div className="space-y-5 pb-4">
            {/* Info cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {dueDisplay && (
                <div className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border',
                  dueDisplay.urgent
                    ? 'bg-red-500/5 border-red-500/20'
                    : dueDisplay.warning
                    ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-muted/30 border-border/50'
                )}>
                  <div className={cn(
                    'p-2 rounded-lg shrink-0',
                    dueDisplay.urgent ? 'bg-red-500/15' :
                    dueDisplay.warning ? 'bg-amber-500/15' : 'bg-muted/50'
                  )}>
                    <Calendar className={cn(
                      'w-4 h-4',
                      dueDisplay.urgent ? 'text-red-400' :
                      dueDisplay.warning ? 'text-amber-400' : 'text-muted-foreground'
                    )} />
                  </div>
                  <div className="min-w-0">
                    <p className={cn(
                      'text-sm font-semibold',
                      dueDisplay.urgent ? 'text-red-400' :
                      dueDisplay.warning ? 'text-amber-400' : ''
                    )}>
                      {dueDisplay.text}
                      {!isCompleted && task.due_time && ` at ${formatTime(task.due_time)}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{dueDisplay.sub}</p>
                  </div>
                </div>
              )}

              {(scheduleOccurrence || scheduleEntry) && (
                <div className="flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
                  <div className="shrink-0 rounded-lg bg-indigo-500/15 p-2">
                    <Clock className="h-4 w-4 text-indigo-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {scheduledStartLabel
                        ? `${scheduledStartLabel}${scheduledEndLabel ? `–${scheduledEndLabel}` : ''}`
                        : 'Untimed'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {[scheduledDateLabel, formatDurationInput(scheduledDuration) || null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              )}

              {task.assignment_type && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
                  <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                    <Tag className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold capitalize">{task.assignment_type}</p>
                    <p className="text-[11px] text-muted-foreground">Assignment Type</p>
                  </div>
                </div>
              )}

              {task.completed_at && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <div className="p-2 rounded-lg bg-emerald-500/15 shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{formatZonedDate(task.completed_at)}</p>
                    <p className="text-[11px] text-muted-foreground">Completed</p>
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            {task.description && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Description
                </h4>
                <div className="p-4 rounded-xl bg-muted/20 border border-border/40 break-words [&_*]:max-w-full">
                  {formatDescription(task.description)}
                </div>
              </div>
            )}

            {/* External Link */}
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 p-3 rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/10 text-primary transition-all group"
              >
                <div className="flex items-center gap-2.5">
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Open in {task.source === 'canvas' ? 'Canvas' : task.source === 'google_classroom' ? 'source LMS' : 'Browser'}
                  </span>
                </div>
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="flex-shrink-0 px-6 py-4 border-t border-border/40 bg-muted/20">
          <div className="flex items-center gap-2 w-full flex-wrap sm:flex-nowrap">
            {task.status === 'pending' && !isOverdue && (
              <Button variant="outline" size="sm" onClick={handleStartProgress} className="gap-1.5">
                <Play className="w-3.5 h-3.5" />
                Start Progress
              </Button>
            )}
            {isExamTask && (
              <Link href="/exams">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onOpenChange(false)}>
                  <GraduationCap className="w-3.5 h-3.5" />
                  View in Exams
                </Button>
              </Link>
            )}
            {onEdit && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onEdit(task); onOpenChange(false); }}>
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </Button>
            )}
            <div className="flex-1" />
            <Button size="sm" onClick={handleComplete} disabled={isUpdatingStatus} className={cn(
              'gap-1.5',
              isCompleted
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            )}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isCompleted ? 'Mark Incomplete' : 'Mark Complete'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
