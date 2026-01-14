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
import { PriorityBadge, StatusBadge, SubjectBadge } from '@/components/ui';
import { formatDate, getDaysUntil, cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar,
  Clock,
  ExternalLink,
  BookOpen,
  Tag,
  CheckCircle2,
  Play,
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

  const handleComplete = () => {
    if (task.status === 'completed') {
      updateTask(task.id, { status: 'pending', completed_at: null });
    } else {
      completeTask(task.id);
    }
    onOpenChange(false);
  };

  const handleStartProgress = () => {
    updateTask(task.id, { status: 'in_progress' });
  };

  // Get source badge info
  const getSourceBadge = () => {
    switch (task.source) {
      case 'canvas':
        return { label: 'Canvas', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' };
      case 'google_classroom':
        return { label: 'Google Classroom', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
      default:
        return null;
    }
  };

  const sourceBadge = getSourceBadge();

  // Format description with line breaks preserved
  const formatDescription = (description: string) => {
    // Check if description contains HTML
    if (description.includes('<') && description.includes('>')) {
      // Sanitize and render HTML description
      return (
        <div 
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: description }}
        />
      );
    }
    
    // Plain text - preserve line breaks
    return (
      <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
        {description}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <DialogTitle className="text-xl leading-tight pr-8">
                {task.title}
              </DialogTitle>
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {subject && (
                  <SubjectBadge name={subject.name} color={subject.color} />
                )}
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                {sourceBadge && (
                  <Badge variant="outline" className={sourceBadge.className}>
                    {sourceBadge.label}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 py-4">
            {/* Due Date & Course Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {task.due_date && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Due Date</p>
                    <p className={cn(
                      'text-sm font-medium',
                      daysUntil !== null && daysUntil < 0
                        ? 'text-red-500'
                        : daysUntil !== null && daysUntil <= 2
                        ? 'text-yellow-500'
                        : ''
                    )}>
                      {formatDate(task.due_date)}
                      {daysUntil !== null && (
                        <span className="ml-2 text-xs">
                          {daysUntil < 0
                            ? `(${Math.abs(daysUntil)} days overdue)`
                            : daysUntil === 0
                            ? '(Today)'
                            : daysUntil === 1
                            ? '(Tomorrow)'
                            : `(${daysUntil} days left)`}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {task.course_name && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <BookOpen className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Course</p>
                    <p className="text-sm font-medium">{task.course_name}</p>
                  </div>
                </div>
              )}

              {task.assignment_type && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Tag className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Type</p>
                    <p className="text-sm font-medium capitalize">{task.assignment_type}</p>
                  </div>
                </div>
              )}

              {task.completed_at && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Completed</p>
                    <p className="text-sm font-medium">{formatDate(task.completed_at)}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            {task.description && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </h4>
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                  {formatDescription(task.description)}
                </div>
              </div>
            )}

            {/* External Link */}
            {task.external_url && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  External Link
                </h4>
                <a
                  href={task.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors group"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm font-medium group-hover:underline">
                    Open in {task.source === 'canvas' ? 'Canvas' : task.source === 'google_classroom' ? 'Google Classroom' : 'Browser'}
                  </span>
                </a>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          {task.status === 'pending' && (
            <Button variant="secondary" onClick={handleStartProgress}>
              <Play className="w-4 h-4 mr-2" />
              Start Progress
            </Button>
          )}
          {onEdit && (
            <Button variant="outline" onClick={() => { onEdit(task); onOpenChange(false); }}>
              Edit Task
            </Button>
          )}
          <Button onClick={handleComplete}>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {task.status === 'completed' ? 'Mark Incomplete' : 'Mark Complete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
