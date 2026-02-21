'use client';

import { useState, memo } from 'react';
import { Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { 
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ConfirmDialog
} from '@/components/ui';
import { SubjectBadge } from '@/components/ui';
import { TaskDetailViewer } from './TaskDetailViewer';
import { formatDate, getDaysUntil, cn, isTaskOverdue, isExamType } from '@/lib/utils';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Clock,
  MoreHorizontal,
  Trash2,
  Edit3,
  Calendar,
  Play,
  Eye,
  ExternalLink,
  GraduationCap,
  AlertTriangle,
  ArrowRight,
  Zap,
} from 'lucide-react';

interface TaskCardProps {
  task: Task;
  onEdit?: (task: Task) => void;
  compact?: boolean;
  index?: number;
}

export const TaskCard = memo(function TaskCard({ task, onEdit, compact = false, index = 0 }: TaskCardProps) {
  const { completeTask, deleteTask, updateTask, subjects } = useAppStore();
  const [showViewer, setShowViewer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const subject = subjects.find((s) => s.id === task.subject_id);
  const daysUntil = task.due_date ? getDaysUntil(task.due_date) : null;

  const isOverdue = isTaskOverdue(task.due_date, task.status);
  const displayPriority = isOverdue ? 'high' : task.priority;
  const isExternalTask = task.source && task.source !== 'manual';
  const isExamTask = isExamType(task.title, task.assignment_type);
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';

  const handleComplete = async () => {
    if (isCompleted) {
      await updateTask(task.id, { status: 'pending', completed_at: null });
    } else {
      await completeTask(task.id);
    }
  };

  const handleStartProgress = async () => {
    await updateTask(task.id, { status: 'in_progress' });
  };

  // Priority config
  const priorityConfig = {
    high: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/20', ring: 'ring-red-500/20', dot: 'bg-red-500', label: 'High' },
    medium: { color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/20', ring: 'ring-amber-500/20', dot: 'bg-amber-500', label: 'Medium' },
    low: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/20', ring: 'ring-emerald-500/20', dot: 'bg-emerald-500', label: 'Low' },
  };

  const pConfig = priorityConfig[displayPriority];

  // Due date display
  const getDueDateDisplay = () => {
    if (!task.due_date) return null;
    if (daysUntil === null) return null;
    
    if (daysUntil < 0) return { text: `${Math.abs(daysUntil)}d overdue`, urgent: true, warning: false };
    if (daysUntil === 0) return { text: 'Due today', urgent: false, warning: true };
    if (daysUntil === 1) return { text: 'Tomorrow', urgent: false, warning: true };
    if (daysUntil <= 3) return { text: `${daysUntil} days left`, urgent: false, warning: true };
    return { text: formatDate(task.due_date), urgent: false, warning: false };
  };

  const dueInfo = getDueDateDisplay();

  // Strip HTML for preview
  const getDescriptionPreview = (description: string) => {
    if (!description) return '';
    if (/<[a-z][\s\S]*>/i.test(description)) {
      return description
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
    return description;
  };

  // Compact mode for dashboard
  if (compact) {
    return (
      <>
        <motion.div
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
          whileHover={{ x: 4 }}
          transition={{ type: 'spring' as const, stiffness: 300, damping: 24 }}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card/50 hover:bg-accent/50 transition-all group cursor-pointer',
            isCompleted && 'opacity-50',
            isOverdue && 'border-red-500/30 bg-red-500/5'
          )}
          onClick={() => setShowViewer(true)}
        >
          <motion.button
            onClick={(e) => { e.stopPropagation(); handleComplete(); }}
            className="flex-shrink-0 text-muted-foreground hover:text-green-500 transition-colors"
            whileTap={{ scale: 0.85 }}
          >
            {isCompleted ? (
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring' as const, stiffness: 400, damping: 15 }}
              >
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              </motion.div>
            ) : (
              <Circle className={cn('w-4 h-4', isOverdue && 'text-red-400')} />
            )}
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-xs font-medium truncate',
              isCompleted && 'line-through text-muted-foreground'
            )}>
              {task.title}
            </p>
          </div>
          {dueInfo && (
            <span className={cn(
              'text-[10px] shrink-0',
              dueInfo.urgent ? 'text-red-400' : dueInfo.warning ? 'text-amber-400' : 'text-muted-foreground'
            )}>
              {dueInfo.text}
            </span>
          )}
          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', pConfig.dot)} />
        </motion.div>
        <TaskDetailViewer
          task={task}
          open={showViewer}
          onOpenChange={setShowViewer}
          onEdit={onEdit}
        />
      </>
    );
  }

  // Full card mode
  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
        whileHover={{ y: -2 }}
        transition={{ type: 'spring' as const, stiffness: 300, damping: 24 }}
        className={cn(
          'group relative rounded-xl border bg-card/80 backdrop-blur-sm overflow-hidden',
          'hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20 transition-all duration-300',
          'hover:border-border/80',
          isCompleted && 'opacity-60',
          isOverdue && 'border-red-500/25 hover:border-red-500/40',
          isInProgress && 'border-indigo-500/25 hover:border-indigo-500/40'
        )}
      >
        {/* Top priority accent line */}
        <div className={cn(
          'absolute top-0 left-0 right-0 h-[2px]',
          displayPriority === 'high' ? 'bg-gradient-to-r from-red-500 via-orange-500 to-red-500' :
          displayPriority === 'medium' ? 'bg-gradient-to-r from-amber-500/60 via-yellow-500/60 to-amber-500/60' :
          'bg-gradient-to-r from-emerald-500/40 via-green-500/40 to-emerald-500/40'
        )} />
        
        {/* Urgent pulsing glow */}
        {displayPriority === 'high' && !isCompleted && (
          <motion.div
            className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500 via-orange-400 to-red-500"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}

        {/* In-progress indicator */}
        {isInProgress && !isCompleted && (
          <motion.div
            className="absolute top-0 left-0 h-[2px] bg-indigo-500"
            initial={{ width: '0%' }}
            animate={{ width: ['0%', '100%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
        )}

        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-3.5">
            {/* Checkbox */}
            <motion.button
              onClick={handleComplete}
              className={cn(
                'mt-0.5 flex-shrink-0 transition-colors',
                isCompleted ? 'text-green-500' : 'text-muted-foreground/50 hover:text-green-500'
              )}
              whileTap={{ scale: 0.8 }}
              whileHover={{ scale: 1.1 }}
            >
              {isCompleted ? (
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring' as const, stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 className="w-[22px] h-[22px]" />
                </motion.div>
              ) : (
                <div className="relative">
                  <Circle className={cn(
                    'w-[22px] h-[22px]',
                    isOverdue && 'text-red-400/60'
                  )} />
                  {isOverdue && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-red-500/40"
                      animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                </div>
              )}
            </motion.button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Title row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3
                      className={cn(
                        'text-sm font-semibold leading-snug cursor-pointer hover:text-primary transition-colors',
                        isCompleted && 'line-through text-muted-foreground'
                      )}
                      onClick={() => setShowViewer(true)}
                    >
                      {task.title}
                    </h3>
                    {isInProgress && !isCompleted && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full">
                        <Zap className="w-2.5 h-2.5" />
                        In Progress
                      </span>
                    )}
                    {isExternalTask && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
                        {task.source === 'canvas' ? 'Canvas' : 'GC'}
                      </Badge>
                    )}
                  </div>

                  {/* Course name */}
                  {task.course_name && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {task.course_name}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Quick action buttons on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                    {task.status === 'pending' && (
                      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-7 w-7 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                          onClick={handleStartProgress}
                        >
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      </motion.div>
                    )}
                    <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-7 w-7 hover:bg-muted"
                        onClick={() => onEdit?.(task)}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                    </motion.div>
                  </div>

                  {/* Menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon-sm"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => setShowViewer(true)}>
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit?.(task)}>
                        <Edit3 className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      {task.external_url && (
                        <DropdownMenuItem onClick={() => window.open(task.external_url!, '_blank')}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Open in {task.source === 'canvas' ? 'Canvas' : 'Browser'}
                        </DropdownMenuItem>
                      )}
                      {isExamTask && (
                        <DropdownMenuItem asChild>
                          <Link href="/exams">
                            <GraduationCap className="w-4 h-4 mr-2" />
                            View in Exams
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => setConfirmDelete(true)}
                        className="text-red-500 focus:text-red-500"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Description preview */}
              {task.description && (
                <p 
                  className="text-[13px] text-muted-foreground/80 line-clamp-1 mt-1.5 cursor-pointer hover:text-muted-foreground transition-colors"
                  onClick={() => setShowViewer(true)}
                >
                  {getDescriptionPreview(task.description)}
                </p>
              )}

              {/* Footer: metadata + due date */}
              <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/30">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Priority pill */}
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium',
                    pConfig.bg, pConfig.color
                  )}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', pConfig.dot)} />
                    {pConfig.label}
                  </span>

                  {subject && (
                    <SubjectBadge name={subject.name} color={subject.color} />
                  )}
                </div>

                {/* Due date */}
                {dueInfo && (
                  <span className={cn(
                    'flex items-center gap-1.5 text-xs font-medium shrink-0',
                    dueInfo.urgent ? 'text-red-400' :
                    dueInfo.warning ? 'text-amber-400' :
                    'text-muted-foreground/70'
                  )}>
                    {dueInfo.urgent ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : (
                      <Calendar className="w-3 h-3" />
                    )}
                    {dueInfo.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Click overlay for detail view */}
        <div
          className="absolute inset-0 cursor-pointer z-0"
          onClick={() => setShowViewer(true)}
          style={{ pointerEvents: 'none' }}
        />
      </motion.div>

      <TaskDetailViewer
        task={task}
        open={showViewer}
        onOpenChange={setShowViewer}
        onEdit={onEdit}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Task"
        description={`Are you sure you want to delete "${task.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteTask(task.id)}
      />
    </>
  );
});
