'use client';

import { useState } from 'react';
import { Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { 
  Card, 
  CardContent,
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui';
import { PriorityBadge, StatusBadge, SubjectBadge } from '@/components/ui';
import { TaskDetailViewer } from './TaskDetailViewer';
import { formatDate, getDaysUntil, cn, isTaskOverdue, calculateSuggestedPriority } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Circle,
  Clock,
  MoreVertical,
  Trash2,
  Edit3,
  Calendar,
  Play,
  Eye,
  ExternalLink,
} from 'lucide-react';

interface TaskCardProps {
  task: Task;
  onEdit?: (task: Task) => void;
  compact?: boolean;
}

export function TaskCard({ task, onEdit, compact = false }: TaskCardProps) {
  const { completeTask, deleteTask, updateTask, subjects } = useAppStore();
  const [showViewer, setShowViewer] = useState(false);
  const subject = subjects.find((s) => s.id === task.subject_id);
  const daysUntil = task.due_date ? getDaysUntil(task.due_date) : null;

  // Check if task is overdue
  const isOverdue = isTaskOverdue(task.due_date, task.status);
  
  // Calculate display priority (use task.priority but show as high if overdue)
  const displayPriority = isOverdue ? 'high' : task.priority;
  
  // Get display status (show overdue instead of pending/in_progress if overdue)
  const displayStatus = isOverdue ? 'overdue' : task.status;

  // Check if task is from external source (Canvas/Google Classroom)
  const isExternalTask = task.source && task.source !== 'manual';

  const handleComplete = async () => {
    if (task.status === 'completed') {
      await updateTask(task.id, { status: 'pending', completed_at: null });
    } else {
      await completeTask(task.id);
    }
  };

  const handleStartProgress = async () => {
    await updateTask(task.id, { status: 'in_progress' });
  };

  if (compact) {
    return (
      <>
        <motion.div
          layout
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className={cn(
            'flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-accent/50 transition-colors group cursor-pointer',
            task.status === 'completed' && 'opacity-60',
            isOverdue && 'border-red-500/30 bg-red-500/5'
          )}
          onClick={() => setShowViewer(true)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); handleComplete(); }}
            className="flex-shrink-0 text-muted-foreground hover:text-green-500 transition-colors"
          >
            {task.status === 'completed' ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-xs font-medium truncate',
              task.status === 'completed' && 'line-through text-muted-foreground'
            )}>
              {task.title}
            </p>
            {task.due_date && (
              <p className={cn(
                "text-[10px] flex items-center gap-1 mt-0.5",
                isOverdue ? "text-red-500" : "text-muted-foreground"
              )}>
                <Clock className="w-3 h-3" />
                {isOverdue ? 'Overdue' : formatDate(task.due_date)}
              </p>
            )}
          </div>
          <PriorityBadge priority={displayPriority} />
          {isExternalTask && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {task.source === 'canvas' ? 'Canvas' : 'GC'}
            </Badge>
          )}
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

  const priorityColors = {
    urgent: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-green-500',
  };

  // Strip HTML for preview display
  const getDescriptionPreview = (description: string) => {
    if (!description) return '';
    
    // Check if contains HTML
    if (/<[a-z][\s\S]*>/i.test(description)) {
      // Remove HTML tags, decode entities, clean up
      let text = description
        .replace(/<br\s*\/?>/gi, ' ') // br to space
        .replace(/<\/p>\s*<p>/gi, ' ') // paragraph breaks
        .replace(/<[^>]*>/g, '') // remove all tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      return text;
    }
    return description;
  };

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <Card className={cn(
          'group relative overflow-hidden hover:shadow-md transition-shadow',
          task.status === 'completed' && 'opacity-70',
          isOverdue && 'border-red-500/30'
        )}>
          {/* Priority indicator */}
          <div className={cn(
            'absolute left-0 top-0 bottom-0 w-1',
            priorityColors[displayPriority]
          )} />

          <CardContent className="p-5 pl-6">
            <div className="flex items-start gap-4">
              {/* Checkbox */}
              <button
                onClick={handleComplete}
                className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-green-500 transition-colors"
              >
                {task.status === 'completed' ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <Circle className="w-5 h-5" />
                )}
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className={cn(
                      'text-sm font-medium leading-tight',
                      task.status === 'completed' && 'line-through text-muted-foreground'
                    )}>
                      {task.title}
                    </h3>
                    {isExternalTask && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                        {task.source === 'canvas' ? 'Canvas' : 'GC'}
                      </Badge>
                    )}
                  </div>

                  {/* Menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
                      <DropdownMenuItem 
                        onClick={() => deleteTask(task.id)}
                        className="text-red-500 focus:text-red-500"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {task.description && (
                  <p 
                    className="text-sm text-muted-foreground line-clamp-2 cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => setShowViewer(true)}
                  >
                    {getDescriptionPreview(task.description)}
                  </p>
                )}

                {/* Course name for external tasks */}
                {task.course_name && (
                  <p className="text-xs text-muted-foreground/80 italic">
                    {task.course_name}
                  </p>
                )}

                {/* Meta */}
                <div className="flex items-center gap-2 flex-wrap">
                  {subject && (
                    <SubjectBadge name={subject.name} color={subject.color} />
                  )}
                  <StatusBadge status={displayStatus} />
                  
                  {task.due_date && (
                    <span className={cn(
                      'flex items-center gap-1 text-xs',
                      daysUntil !== null && daysUntil < 0
                        ? 'text-red-500'
                        : daysUntil !== null && daysUntil <= 2
                        ? 'text-yellow-500'
                        : 'text-muted-foreground'
                    )}>
                      <Calendar className="w-3 h-3" />
                      {daysUntil !== null && daysUntil < 0
                        ? 'Overdue'
                        : daysUntil === 0
                        ? 'Today'
                        : daysUntil === 1
                        ? 'Tomorrow'
                        : formatDate(task.due_date)}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {task.status === 'pending' && (
                    <Button size="sm" variant="secondary" onClick={handleStartProgress}>
                      <Play className="w-3 h-3" />
                      Start
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setShowViewer(true)}>
                    <Eye className="w-3 h-3" />
                    View
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
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
