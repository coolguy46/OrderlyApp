'use client';

import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { Task, Exam } from '@/lib/supabase/types';
import { cn, getDaysUntil } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Badge, Progress,
} from '@/components/ui';
import {
  Brain, Calendar, Clock, Zap, Sparkles, ChevronRight,
  AlertTriangle, CheckCircle2, RefreshCw, GraduationCap,
  Target, TrendingUp, BookOpen, Star,
} from 'lucide-react';
import { format, addDays, isToday, isTomorrow } from 'date-fns';
import { toast } from 'sonner';

// ─────────────────── Scheduler Logic ───────────────────

interface ScheduledBlock {
  date: string;
  displayDate: string;
  tasks: Task[];
  exams: Exam[];
  estimatedMinutes: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

function scoreTask(task: Task): number {
  let score = 0;
  // Priority weight
  if (task.priority === 'high') score += 40;
  else if (task.priority === 'medium') score += 20;
  else score += 10;
  // Due date proximity
  if (task.due_date) {
    const days = getDaysUntil(task.due_date);
    if (days <= 0) score += 50; // overdue
    else if (days <= 1) score += 40;
    else if (days <= 3) score += 30;
    else if (days <= 7) score += 20;
    else if (days <= 14) score += 10;
  }
  return score;
}

function generateSchedule(tasks: Task[], exams: Exam[], studyHoursPerDay: number): ScheduledBlock[] {
  const today = new Date();
  const schedule: ScheduledBlock[] = [];
  const minutesPerDay = studyHoursPerDay * 60;

  // Get pending tasks sorted by score
  const pending = tasks
    .filter(t => t.status !== 'completed')
    .sort((a, b) => scoreTask(b) - scoreTask(a));

  // Get upcoming exams
  const upcoming = exams
    .filter(e => new Date(e.exam_date) >= today)
    .sort((a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime());

  // Build 7-day schedule
  let taskIndex = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayTasks: Task[] = [];
    const dayExams: Exam[] = [];
    let minutesUsed = 0;

    // Add tasks for this day (tasks due on this day get priority)
    const dueTodayTasks = pending.filter(t => {
      if (!t.due_date) return false;
      return t.due_date.startsWith(dateStr);
    });
    for (const task of dueTodayTasks) {
      if (!dayTasks.includes(task)) {
        dayTasks.push(task);
        minutesUsed += task.priority === 'high' ? 45 : 30;
      }
    }

    // Fill remaining time with next priority tasks
    while (minutesUsed < minutesPerDay - 30 && taskIndex < pending.length) {
      const task = pending[taskIndex];
      if (!dayTasks.includes(task)) {
        dayTasks.push(task);
        minutesUsed += task.priority === 'high' ? 45 : 30;
      }
      taskIndex++;
    }

    // Add exams happening this day or review sessions for upcoming exams
    const examsToday = upcoming.filter(e => e.exam_date.startsWith(dateStr));
    dayExams.push(...examsToday);

    // Exam review sessions (2 days before exam)
    const reviewExams = upcoming.filter(e => {
      const daysToExam = getDaysUntil(e.exam_date);
      return daysToExam > 0 && daysToExam <= 2;
    });
    dayExams.push(...reviewExams.filter(e => !dayExams.includes(e)));

    // Determine priority level
    let priority: ScheduledBlock['priority'] = 'low';
    let reason = 'Regular study day';

    if (examsToday.length > 0) {
      priority = 'critical';
      reason = `Exam day: ${examsToday.map(e => e.title).join(', ')}`;
    } else if (dayTasks.some(t => t.priority === 'high' && t.due_date?.startsWith(dateStr))) {
      priority = 'critical';
      reason = 'High-priority tasks due today';
    } else if (reviewExams.length > 0) {
      priority = 'high';
      reason = `Exam review: ${reviewExams.map(e => e.title).join(', ')}`;
    } else if (dayTasks.some(t => t.priority === 'high')) {
      priority = 'high';
      reason = 'High-priority tasks scheduled';
    } else if (dayTasks.length > 0) {
      priority = 'medium';
      reason = `${dayTasks.length} tasks to complete`;
    }

    const displayDate = isToday(date) ? 'Today' : isTomorrow(date) ? 'Tomorrow' : format(date, 'EEEE, MMM d');

    schedule.push({
      date: dateStr,
      displayDate,
      tasks: dayTasks,
      exams: dayExams,
      estimatedMinutes: minutesUsed,
      priority,
      reason,
    });
  }

  return schedule;
}

const priorityConfig = {
  low: { color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', label: 'Light' },
  medium: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Moderate' },
  high: { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', label: 'Heavy' },
  critical: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'Critical' },
};

// ─────────────────── Component ───────────────────

export function AIScheduler() {
  const { tasks, exams, studySessions } = useAppStore();
  const [studyHours, setStudyHours] = useState(3);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const schedule = useMemo(() => {
    if (!generated) return [];
    return generateSchedule(tasks, exams, studyHours);
  }, [tasks, exams, studyHours, generated]);

  const totalPendingTasks = tasks.filter(t => t.status !== 'completed').length;
  const upcomingExams = exams.filter(e => new Date(e.exam_date) >= new Date());
  const overdueTasks = tasks.filter(t => {
    if (!t.due_date || t.status === 'completed') return false;
    return new Date(t.due_date) < new Date();
  });

  const handleGenerate = () => {
    setGenerating(true);
    // Simulate AI processing delay
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
      toast.success('✨ Schedule generated!', { description: 'Your 7-day study plan is ready.' });
    }, 1500);
  };

  const handleRegenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      toast.success('Schedule updated!');
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-2xl border border-indigo-500/20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-3 bg-indigo-500/20 rounded-xl">
              <Brain className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                AI Smart Scheduler
                <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-[10px]">Beta</Badge>
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Automatically creates your study schedule based on tasks, exams, and priorities
              </p>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <div className="p-3 bg-background/60 rounded-xl text-center">
            <p className="text-2xl font-bold">{totalPendingTasks}</p>
            <p className="text-xs text-muted-foreground">Pending Tasks</p>
          </div>
          <div className="p-3 bg-background/60 rounded-xl text-center">
            <p className="text-2xl font-bold">{upcomingExams.length}</p>
            <p className="text-xs text-muted-foreground">Upcoming Exams</p>
          </div>
          <div className="p-3 bg-background/60 rounded-xl text-center">
            <p className={cn('text-2xl font-bold', overdueTasks.length > 0 && 'text-red-400')}>{overdueTasks.length}</p>
            <p className="text-xs text-muted-foreground">Overdue</p>
          </div>
        </div>

        {/* Settings */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Daily study goal</span>
              <span className="text-sm font-bold">{studyHours}h / day</span>
            </div>
            <input
              type="range"
              min={1} max={12} step={0.5}
              value={studyHours}
              onChange={e => setStudyHours(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>
          <Button
            onClick={generated ? handleRegenerate : handleGenerate}
            disabled={generating}
            className="gap-2 shrink-0"
          >
            {generating ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Zap className="w-4 h-4" />
              </motion.div>
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {generating ? 'Generating…' : generated ? 'Regenerate' : 'Generate Schedule'}
          </Button>
        </div>
      </div>

      {/* Overdue warning */}
      {overdueTasks.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">You have {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}</p>
            <p className="text-xs text-muted-foreground">{overdueTasks.slice(0, 2).map(t => t.title).join(', ')}{overdueTasks.length > 2 ? ` +${overdueTasks.length - 2} more` : ''}</p>
          </div>
        </motion.div>
      )}

      {/* Schedule */}
      {!generated ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl">
          <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-40" />
          <p className="font-semibold text-lg">Ready to create your schedule</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            Set your daily study goal above and click "Generate Schedule" to get a personalized 7-day study plan.
          </p>
          <Button onClick={handleGenerate} disabled={generating} className="mt-5 gap-2">
            <Sparkles className="w-4 h-4" />
            {generating ? 'Generating…' : 'Generate My Schedule'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" />
              Your 7-Day Study Plan
            </h3>
            <button onClick={handleRegenerate} disabled={generating} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className={cn('w-3.5 h-3.5', generating && 'animate-spin')} />
              Refresh
            </button>
          </div>

          <AnimatePresence>
            {schedule.map((block, i) => {
              const cfg = priorityConfig[block.priority];
              const isExpanded = expanded === block.date;

              return (
                <motion.div
                  key={block.date}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <Card className={cn('glow-border overflow-hidden', block.priority === 'critical' && 'border-red-500/30')}>
                    <button
                      className="w-full p-4 flex items-center gap-4 hover:bg-muted/20 transition-colors text-left"
                      onClick={() => setExpanded(isExpanded ? null : block.date)}
                    >
                      {/* Day indicator */}
                      <div className={cn('w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 border', cfg.bg)}>
                        <span className={cn('text-xs font-medium', cfg.color)}>{format(new Date(block.date + 'T12:00:00'), 'EEE')}</span>
                        <span className="text-base font-bold">{format(new Date(block.date + 'T12:00:00'), 'd')}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{block.displayDate}</span>
                          <Badge className={cn('text-[10px]', cfg.bg, cfg.color)}>{cfg.label}</Badge>
                          {block.exams.length > 0 && (
                            <Badge className="text-[10px] bg-purple-500/20 text-purple-400 border-purple-500/30">
                              <GraduationCap className="w-2.5 h-2.5 mr-1" />
                              {block.exams.length} exam
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{block.reason}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{Math.round(block.estimatedMinutes / 60 * 10) / 10}h</p>
                        <p className="text-xs text-muted-foreground">{block.tasks.length} tasks</p>
                      </div>

                      <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: 'auto' }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                            {block.tasks.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Tasks to work on</h5>
                                <div className="space-y-2">
                                  {block.tasks.map(task => (
                                    <div key={task.id} className="flex items-center gap-3 p-2.5 bg-muted/30 rounded-xl text-sm">
                                      <div className={cn(
                                        'w-2 h-2 rounded-full shrink-0',
                                        task.priority === 'high' ? 'bg-red-400' : task.priority === 'medium' ? 'bg-yellow-400' : 'bg-green-400'
                                      )} />
                                      <span className="flex-1 truncate">{task.title}</span>
                                      {task.due_date && (
                                        <span className="text-xs text-muted-foreground shrink-0">
                                          {getDaysUntil(task.due_date) <= 0 ? '⚠️ Overdue' : `${getDaysUntil(task.due_date)}d left`}
                                        </span>
                                      )}
                                      <span className="text-xs text-muted-foreground shrink-0">~{task.priority === 'high' ? 45 : 30}min</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {block.exams.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Exams</h5>
                                <div className="space-y-2">
                                  {block.exams.map(exam => (
                                    <div key={exam.id} className="flex items-center gap-3 p-2.5 bg-purple-500/10 rounded-xl text-sm border border-purple-500/20">
                                      <GraduationCap className="w-4 h-4 text-purple-400 shrink-0" />
                                      <span className="flex-1 truncate font-medium">{exam.title}</span>
                                      <span className="text-xs text-purple-400">{format(new Date(exam.exam_date), 'MMM d')}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {block.tasks.length === 0 && block.exams.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-2">Rest day — you're ahead of schedule! 🎉</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Summary */}
          <Card className="glow-border bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
            <CardContent className="p-5">
              <h4 className="font-semibold flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-indigo-400" />
                Schedule Summary
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-muted/30 rounded-xl">
                  <p className="text-xl font-bold">{schedule.reduce((acc, b) => acc + b.tasks.length, 0)}</p>
                  <p className="text-xs text-muted-foreground">Tasks Scheduled</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-xl">
                  <p className="text-xl font-bold">{Math.round(schedule.reduce((acc, b) => acc + b.estimatedMinutes, 0) / 60)}h</p>
                  <p className="text-xs text-muted-foreground">Total Study Time</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-xl">
                  <p className="text-xl font-bold text-red-400">{schedule.filter(b => b.priority === 'critical').length}</p>
                  <p className="text-xs text-muted-foreground">Critical Days</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-xl">
                  <p className="text-xl font-bold text-green-400">{schedule.filter(b => b.tasks.length === 0 && b.exams.length === 0).length}</p>
                  <p className="text-xs text-muted-foreground">Rest Days</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
