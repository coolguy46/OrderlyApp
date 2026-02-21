'use client';

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
import { formatDate, getDaysUntil, cn, isTaskOverdue, isExamType } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Calendar,
  Clock,
  ExternalLink,
  BookOpen,
  Tag,
  CheckCircle2,
  Play,
  GraduationCap,
  AlertTriangle,
  Edit3,
  Zap,
  ArrowUpRight,
} from 'lucide-react';

interface TaskDetailViewerProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (task: Task) => void;
}

export function TaskDetailViewer({ task, open, onOpenChange, onEdit }: TaskDetailViewerProps) {
  const { subjects, completeTask, updateTask } = useAppStore();
  
  if (!task) return null;
  
  const subject = subjects.find((s) => s.id === task.subject_id);
  const daysUntil = task.due_date ? getDaysUntil(task.due_date) : null;
  const isOverdue = isTaskOverdue(task.due_date, task.status);
  const displayPriority = isOverdue ? 'high' : task.priority;
  const isExamTask = isExamType(task.title, task.assignment_type);
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';

  const handleComplete = async () => {
    if (isCompleted) {
      await updateTask(task.id, { status: 'pending', completed_at: null });
    } else {
      await completeTask(task.id);
    }
    onOpenChange(false);
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
      case 'google_classroom': return { label: 'Google Classroom', className: 'bg-blue-500/15 text-blue-400 border-blue-500/20' };
      default: return null;
    }
  };
  const sourceInfo = getSourceInfo();

  // Due date display
  const getDueDisplay = () => {
    if (!task.due_date || daysUntil === null) return null;
    if (daysUntil < 0) return { text: `${Math.abs(daysUntil)} days overdue`, sub: formatDate(task.due_date), urgent: true, warning: false };
    if (daysUntil === 0) return { text: 'Due Today', sub: formatDate(task.due_date), urgent: false, warning: true };
    if (daysUntil === 1) return { text: 'Due Tomorrow', sub: formatDate(task.due_date), urgent: false, warning: true };
    if (daysUntil <= 3) return { text: `${daysUntil} days left`, sub: formatDate(task.due_date), urgent: false, warning: true };
    return { text: formatDate(task.due_date), sub: `${daysUntil} days left`, urgent: false, warning: false };
  };
  const dueDisplay = getDueDisplay();

  // Format description
  const formatDescription = (description: string) => {
    if (!description) return null;
    
    const decodeHTMLEntities = (text: string) => {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
      return textarea.value;
    };
    
    const hasHTMLTags = /<[a-z][\s\S]*>/i.test(description);
    
    if (hasHTMLTags) {
      let cleanedHtml = description
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p>/gi, '\n\n')
        .replace(/<\/div>\s*<div>/gi, '\n')
        .trim();
      
      const textContent = cleanedHtml.replace(/<[^>]*>/g, '').trim();
      if (!textContent) return null;
      
      return (
        <div 
          className="prose prose-sm dark:prose-invert max-w-none 
            prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
            prose-headings:my-2 prose-a:text-primary prose-a:no-underline hover:prose-a:underline
            [&_*]:text-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: cleanedHtml }}
        />
      );
    }
    
    const decodedText = decodeHTMLEntities(description);
    return (
      <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
        {decodedText}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0">
        {/* Header with gradient accent */}
        <div className={cn(
          'relative px-6 pt-6 pb-4',
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
            </div>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="flex-1 -mt-1 px-6 min-h-0 overflow-y-auto">
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
                    </p>
                    <p className="text-[11px] text-muted-foreground">{dueDisplay.sub}</p>
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
                    <p className="text-sm font-semibold">{formatDate(task.completed_at)}</p>
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
                <div className="p-4 rounded-xl bg-muted/20 border border-border/40">
                  {formatDescription(task.description)}
                </div>
              </div>
            )}

            {/* External Link */}
            {task.external_url && (
              <a
                href={task.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 p-3 rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/10 text-primary transition-all group"
              >
                <div className="flex items-center gap-2.5">
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Open in {task.source === 'canvas' ? 'Canvas' : task.source === 'google_classroom' ? 'Google Classroom' : 'Browser'}
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
            <Button size="sm" onClick={handleComplete} className={cn(
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
