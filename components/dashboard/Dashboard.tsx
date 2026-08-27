'use client';

import { useMemo, useState, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  Button,
  Progress,
  Badge
} from '@/components/ui';
import { SubjectBadge } from '@/components/ui';
import { TaskCard, TaskForm } from '@/components/tasks';
import { DashboardSchedule } from './DashboardSchedule';
import { usePlannerStore } from '@/lib/planner/store';
import { getDefaultPlannerSettings } from '@/lib/planner/types';
import { isMonthlyRecurrenceDate, localDateFromIso, taskUntimedDisplayDate } from '@/lib/schedule/selectors';
import { selectDashboardTasksForDate } from '@/lib/dashboard-tasks';
import { cn, isExamType } from '@/lib/utils';
import { civilDateFromStored, formatCivilDate } from '@/lib/civil-date';
import { examDateInputValue, examDayDistance, examTemporalStatus } from '@/lib/exam-status';
import { isGoalComplete } from '@/lib/goal-status';
import { isTaskMissing, isTaskMissingFromPriorDay } from '@/lib/task-status';
import { useCurrentTime } from '@/lib/use-current-time';
import { useHydrated } from '@/lib/use-hydrated';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  CheckCircle2,
  Target,
  AlertTriangle,
  Calendar,
  GraduationCap,
  Play,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Sparkles,
  ListTodo,
  CalendarClock,
} from 'lucide-react';

// Framer motion variants
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { 
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 }
  }
};

// Normalize any date value to a 'yyyy-MM-dd' string in local time.
// Handles ISO strings, date-only strings, and Date objects consistently.
function toLocalDateStr(d: string | Date, timeZone: string): string | null {
  if (typeof d === 'string') {
    return civilDateFromStored(d, timeZone);
  }
  return localDateFromIso(d.toISOString(), timeZone);
}

function localDateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function Dashboard() {
  const { tasks, goals, exams, subjects, user } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const now = useCurrentTime();
  const mounted = useHydrated();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentDateTimeZone, setCurrentDateTimeZone] = useState<string | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [mainView, setMainView] = useState<'tasks' | 'schedule'>('tasks');
  // Store selected date as a stable string to avoid Date reference / timezone issues
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);

  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const plannerSettings = (user?.id ? plannerUsers[user.id]?.settings : null)
    || getDefaultPlannerSettings(fallbackTimeZone);
  const taskDisplayOptions = useMemo(() => ({
    timeZone: plannerSettings.timeZone,
    schoolDays: plannerSettings.schoolDays,
    schoolStartTime: plannerSettings.schoolStartTime,
    schoolHomeTime: plannerSettings.schoolHomeTime,
  }), [plannerSettings.schoolDays, plannerSettings.schoolHomeTime, plannerSettings.schoolStartTime, plannerSettings.timeZone]);
  const todayKey = localDateFromIso(now.toISOString(), taskDisplayOptions.timeZone);
  const viewingDateKey = selectedDateStr || todayKey;
  const isViewingToday = Boolean(viewingDateKey && viewingDateKey === todayKey);
  const selectedDateLabel = viewingDateKey
    ? formatCivilDate(viewingDateKey, taskDisplayOptions.timeZone, { month: 'short', day: 'numeric' })
    : null;

  if (mounted && todayKey && currentDateTimeZone !== taskDisplayOptions.timeZone) {
    setCurrentDate(localDateFromKey(todayKey));
    setCurrentDateTimeZone(taskDisplayOptions.timeZone);
  }

  // Today's stats
  const todayStats = useMemo(() => {
    if (!mounted) return { tasksCompleted: 0, tasksDue: 0 };
    
    const today = localDateFromIso(now.toISOString(), taskDisplayOptions.timeZone);
    if (!today) return { tasksCompleted: 0, tasksDue: 0 };
    const todayTasks = selectDashboardTasksForDate(tasks, today, now, taskDisplayOptions);
    const completedToday = tasks.filter(
      (t) => t.completed_at && localDateFromIso(t.completed_at, taskDisplayOptions.timeZone) === today
    ).length;

    return {
      tasksCompleted: completedToday,
      tasksDue: todayTasks.length,
    };
  }, [tasks, mounted, now, taskDisplayOptions]);

  const missingTasks = useMemo(
    () => tasks.filter(task => isTaskMissingFromPriorDay(task, now, taskDisplayOptions.timeZone)),
    [now, taskDisplayOptions.timeZone, tasks],
  );

  // The dashboard is a single-day view. It defaults to today and only changes
  // when the user explicitly chooses another day in the mini calendar.
  const upcomingTasks = useMemo(() => {
    if (!viewingDateKey) return [];
    return selectDashboardTasksForDate(tasks, viewingDateKey, now, taskDisplayOptions);
  }, [now, taskDisplayOptions, tasks, viewingDateKey]);

  // Active goals
  const activeGoals = useMemo(() => {
    return goals.filter((g) => g.status === 'active' && !isGoalComplete(g)).slice(0, 3);
  }, [goals]);

  // Upcoming exams
  const upcomingExams = useMemo(() => {
    if (!mounted) return [];
    return exams
      .filter((exam) => examTemporalStatus(exam, now, taskDisplayOptions.timeZone) === 'upcoming')
      .sort((a, b) =>
        examDateInputValue(a, taskDisplayOptions.timeZone)
          .localeCompare(examDateInputValue(b, taskDisplayOptions.timeZone))
      )
      .slice(0, 3);
  }, [exams, mounted, now, taskDisplayOptions.timeZone]);

  // Calendar days for mini calendar
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days: Date[] = [];
    let day = startDate;
    while (day <= endDate) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentDate]);

  const getEventsForDate = useCallback((date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayOfWeek = date.getDay();
    const dayTasks = tasks.filter((task) => {
      // Exact due_date match
      if (task.due_date && taskUntimedDisplayDate(task, taskDisplayOptions) === dateStr) return true;

      // Recurring task expansion
      if (task.recurrence && task.recurrence !== 'none' && task.status !== 'completed') {
        const taskStartKey = toLocalDateStr(task.due_date || task.created_at, taskDisplayOptions.timeZone);
        if (!taskStartKey) return false;
        if (dateStr < taskStartKey) return false;
        if (task.due_date && toLocalDateStr(task.due_date, taskDisplayOptions.timeZone) === dateStr) return false;

        if (task.recurrence === 'daily') return true;
        if (task.recurrence === 'weekly') {
          if (task.recurrence_days && task.recurrence_days.length > 0) {
            return task.recurrence_days.includes(dayOfWeek);
          }
          const taskStart = new Date(`${taskStartKey}T12:00:00`);
          return date.getDay() === taskStart.getDay();
        }
        if (task.recurrence === 'monthly') {
          return isMonthlyRecurrenceDate(dateStr, taskStartKey);
        }
      }

      return false;
    });
    const dayExams = exams.filter((exam) => {
      return civilDateFromStored(exam.exam_date, taskDisplayOptions.timeZone) === dateStr;
    });
    return { tasks: dayTasks, exams: dayExams };
  }, [tasks, exams, taskDisplayOptions]);

  return (
    <motion.div 
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      {/* Welcome Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-0.5 sm:space-y-1">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}! 
            <motion.span
              animate={{ rotate: [0, 14, -8, 14, -4, 10, 0] }}
              transition={{ duration: 1.5, delay: 0.5, ease: 'easeInOut' }}
              className="inline-block origin-[70%_80%]"
            >
              👋
            </motion.span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {mounted && todayKey
              ? formatCivilDate(todayKey, taskDisplayOptions.timeZone, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '\u00A0'}
          </p>
        </div>
        <Link href="/study" className="self-start sm:self-auto">
          <Button size="sm" className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/20 rounded-xl text-white h-9 sm:h-10 sm:px-5">
            <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm">Start Study</span>
          </Button>
        </Link>
      </motion.div>

      {/* Stats Grid - Animated */}
      <motion.div variants={containerVariants} className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
        {[
          { label: 'Completed', value: String(todayStats.tasksCompleted), sub: `${todayStats.tasksDue} due today`, icon: CheckCircle2, color: 'green', gradient: 'from-green-500/10 to-emerald-500/10', borderColor: 'border-green-500/20', href: null },
          { label: 'Goals', value: String(activeGoals.length), sub: `${goals.filter(isGoalComplete).length} done`, icon: Target, color: 'purple', gradient: 'from-purple-500/10 to-pink-500/10', borderColor: 'border-purple-500/20', href: null },
          { label: 'Missing', value: String(missingTasks.length), sub: missingTasks.length === 1 ? '1 overdue task' : `${missingTasks.length} overdue tasks`, icon: AlertTriangle, color: 'red', gradient: 'from-red-500/10 to-rose-500/10', borderColor: 'border-red-500/20', href: '/tasks?view=missing' },
        ].map((stat) => (
          <motion.div key={stat.label} variants={itemVariants}>
            {(() => {
              const card = (
                <Card className={cn(
                  'overflow-hidden border bg-gradient-to-br backdrop-blur-sm transition-all active:scale-[0.98]',
                  stat.href && 'hover:-translate-y-0.5 hover:shadow-md',
                  stat.gradient, stat.borderColor
                )}>
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-0.5 sm:space-y-1 min-w-0">
                        <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">{stat.label}</p>
                        <p className="text-lg sm:text-xl font-bold tracking-tight">{stat.value}</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{stat.sub}</p>
                      </div>
                      <div className={`p-2 sm:p-2.5 rounded-xl bg-${stat.color}-500/10 shrink-0`}>
                        <stat.icon className={`w-4 h-4 sm:w-5 sm:h-5 text-${stat.color}-500`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              return stat.href ? (
                <Link href={stat.href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View ${stat.sub}`}>
                  {card}
                </Link>
              ) : card;
            })()}
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold font-display">Your day</h2>
          <p className="text-[11px] text-muted-foreground">Switch between what is due and when you plan to do it.</p>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-border/50 bg-muted/35 p-0.5" role="tablist" aria-label="Dashboard task or schedule view">
          {([
            { id: 'tasks' as const, label: 'Tasks', icon: ListTodo },
            { id: 'schedule' as const, label: 'Schedule', icon: CalendarClock },
          ]).map(item => {
            const selected = mainView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMainView(item.id)}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon className={cn('h-3.5 w-3.5', selected && item.id === 'schedule' && 'text-indigo-400')} />
                {item.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Main Content - deadline tasks or the selected day's schedule */}
      <AnimatePresence mode="wait">
      {mainView === 'tasks' ? (
      <motion.div
        key="dashboard-tasks"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        className="grid gap-4 lg:grid-cols-3"
      >
        {/* Upcoming Tasks - shown first on mobile for priority */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          <Card className="border-border/50 interactive-card">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 shadow-sm">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-display">
                      {isViewingToday ? "Today's Tasks" : `Tasks for ${selectedDateLabel || 'selected date'}`}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {upcomingTasks.length} {upcomingTasks.length === 1 ? 'task' : 'tasks'} {isViewingToday ? 'for today' : 'on this date'}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isViewingToday && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="gap-1 text-xs h-7"
                      onClick={() => setSelectedDateStr(null)}
                    >
                      <X className="w-3 h-3" />
                      Back to Today
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-foreground hover:text-foreground h-7 px-2"
                    onClick={() => setShowTaskForm(true)}
                  >
                    <Plus className="w-3 h-3" />
                    New Task
                  </Button>
                  <Link href="/tasks">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs h-7">
                      View All
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <AnimatePresence mode="wait">
                {upcomingTasks.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="text-center py-8 text-muted-foreground"
                  >
                    <motion.div
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    </motion.div>
                    <p className="font-medium text-sm">Nothing due here</p>
                    <p className="text-xs mb-3">No tasks belong to this day.</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setShowTaskForm(true)}
                    >
                      <Plus className="w-3 h-3" />
                      Create Task
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`tasks-${viewingDateKey || 'today'}`}
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                    className="max-h-[26rem] space-y-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[30rem]"
                  >
                    {upcomingTasks.map((task) => (
                      <motion.div
                        key={task.id}
                        variants={{
                          hidden: { opacity: 0, x: -10 },
                          show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
                        }}
                      >
                        <TaskCard task={task} compact currentTime={now} timeZone={taskDisplayOptions.timeZone} />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>

        {/* Mini Calendar - shown first on mobile for context */}
        <div className="order-1 lg:order-2">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-500/10">
                    <Calendar className="w-4 h-4 text-blue-500" />
                  </div>
                  <CardTitle className="text-base">{format(currentDate, 'MMM yyyy')}</CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* Week days */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                  <div key={i} className="text-center text-xs font-medium text-muted-foreground py-1">
                    {day}
                  </div>
                ))}
              </div>
              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, index) => {
                  const dayKey = format(day, 'yyyy-MM-dd');
                  const dayEvents = getEventsForDate(day);
                  const hasEvents = dayEvents.tasks.length > 0 || dayEvents.exams.length > 0;
                  const hasMissingTasks = dayEvents.tasks.some(task =>
                    isTaskMissing(task, now, taskDisplayOptions.timeZone)
                  );
                  const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDateStr(dayKey === todayKey ? null : dayKey)}
                      className={cn(
                        'aspect-square text-xs rounded-lg flex flex-col items-center justify-center transition-all relative group/day min-h-[36px] sm:min-h-0',
                        !isCurrentMonth && 'opacity-30',
                        dayKey === todayKey && 'bg-primary/20 border border-primary font-bold dot-pulse',
                        viewingDateKey === dayKey && 'bg-primary/10 ring-1 ring-primary/50',
                        hasMissingTasks && 'border border-red-500/70 bg-red-500/15 text-red-300',
                        hasMissingTasks && viewingDateKey === dayKey && 'ring-1 ring-red-500/70',
                        dayKey !== todayKey && 'hover:bg-muted hover:scale-110'
                      )}
                    >
                      {format(day, 'd')}
                      {hasEvents && (
                        <div className="absolute bottom-0.5 flex gap-0.5">
                          {dayEvents.tasks.slice(0, 2).map((t, i) => (
                            <div key={i} className={cn(
                              'w-1 h-1 rounded-full',
                              isTaskMissing(t, now, taskDisplayOptions.timeZone)
                                ? 'bg-red-500'
                                : isExamType(t.title, t.assignment_type) ? 'bg-purple-500' : 'bg-primary'
                            )} />
                          ))}
                          {dayEvents.exams.slice(0, 1).map((_, i) => (
                            <div key={`e-${i}`} className="w-1 h-1 rounded-full bg-purple-500" />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <Link href="/calendar" className="block mt-3">
                <Button variant="outline" size="sm" className="w-full text-xs h-7">
                  Open Full Calendar
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </motion.div>
      ) : (
        <motion.div
          key="dashboard-schedule"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
        >
          <DashboardSchedule />
        </motion.div>
      )}
      </AnimatePresence>

      {/* Bottom Section - Goals and Exams side by side */}
      <motion.div variants={itemVariants} className="grid gap-4 lg:grid-cols-2">
        {/* Goals Progress */}
        <Card className="border-border/50 interactive-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 shadow-sm">
                  <Target className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-base font-display">Goals</CardTitle>
              </div>
              <Link href="/goals">
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {activeGoals.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2, repeat: Infinity }}>
                  <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                </motion.div>
                <p className="text-sm mb-2">No active goals</p>
                <Link href="/goals">
                  <Button size="sm" variant="outline" className="gap-1">
                    <Plus className="w-3 h-3" />
                    Set a Goal
                  </Button>
                </Link>
              </div>
            ) : (
              activeGoals.map((goal, i) => {
                const progress = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100));
                return (
                  <motion.div
                    key={goal.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{goal.title}</span>
                      <span className="text-xs font-semibold text-muted-foreground">{progress}%</span>
                    </div>
                    <div className="relative">
                      <Progress value={progress} className="h-1.5" />
                      {progress >= 100 && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -right-1 -top-1"
                        >
                          <Sparkles className="w-3 h-3 text-yellow-500" />
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Upcoming Exams */}
        <Card className="border-border/50 interactive-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 shadow-sm">
                  <GraduationCap className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-base font-display">Upcoming Exams</CardTitle>
              </div>
              <Link href="/exams">
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {upcomingExams.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2, repeat: Infinity }}>
                  <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-50" />
                </motion.div>
                <p className="text-sm">No upcoming exams</p>
              </div>
            ) : (
              upcomingExams.map((exam, i) => {
                const daysUntil = examDayDistance(exam, now, taskDisplayOptions.timeZone);
                const subject = subjects.find((s) => s.id === exam.subject_id);
                const isUrgent = daysUntil !== null && daysUntil <= 7;

                return (
                  <motion.div
                    key={exam.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={cn(
                      'p-3 rounded-lg border transition-all hover:shadow-md',
                      isUrgent ? 'bg-red-500/5 border-red-500/20' : 'bg-muted/30 hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium text-sm">{exam.title}</p>
                        {subject && (
                          <SubjectBadge name={subject.name} color={subject.color} />
                        )}
                      </div>
                      <Badge variant={isUrgent ? "destructive" : "secondary"} className={cn("shrink-0 text-xs", isUrgent && "animate-breathe")}>
                        {daysUntil === null ? 'Date unavailable' : daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </Badge>
                    </div>
                    <div className="mt-2 relative">
                      <Progress value={exam.preparation_progress} className="h-1" />
                    </div>
                  </motion.div>
                );
              })
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Quick Actions - Animated */}
      <motion.div variants={itemVariants}>
        <Card className="border-border/50 accent-line-top">
          <CardContent className="p-2.5 sm:p-3">
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
              {[
                { href: null, icon: Plus, label: 'Add Task', gradient: 'from-emerald-500 to-teal-500' },
                { href: '/study', icon: Clock, label: 'Study', gradient: 'from-indigo-500 to-blue-500' },
                { href: '/goals', icon: Target, label: 'Goals', gradient: 'from-purple-500 to-pink-500' },
                { href: '/calendar', icon: Calendar, label: 'Calendar', gradient: 'from-blue-500 to-cyan-500' },
              ].map((action) => {
                const actionButton = (
                  <Button
                    variant="outline"
                    className="w-full h-auto py-3 sm:py-3.5 flex-col gap-1.5 sm:gap-2 hover:bg-muted/50 hover:border-border transition-all group active:scale-[0.97]"
                    onClick={action.href ? undefined : () => setShowTaskForm(true)}
                  >
                    <div className={cn('p-1.5 rounded-lg bg-gradient-to-br opacity-80 group-hover:opacity-100 transition-opacity', action.gradient)}>
                      <action.icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-[10px] sm:text-xs font-medium">{action.label}</span>
                  </Button>
                );

                return action.href ? (
                  <Link key={action.label} href={action.href}>
                    {actionButton}
                  </Link>
                ) : (
                  <div key={action.label}>
                    {actionButton}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <TaskForm
        isOpen={showTaskForm}
        onClose={() => setShowTaskForm(false)}
      />
    </motion.div>
  );
}
