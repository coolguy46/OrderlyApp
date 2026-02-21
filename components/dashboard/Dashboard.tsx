'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
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
import { TaskCard } from '@/components/tasks';
import { formatDuration, getDaysUntil, cn, isExamType } from '@/lib/utils';
import { format, isSameDay, isToday, startOfDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  CheckCircle2,
  Target,
  Flame,
  Calendar,
  GraduationCap,
  Play,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Sparkles,
} from 'lucide-react';

// Animated counter hook
function useAnimatedCounter(target: number, duration: number = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let start = 0;
    const startTime = performance.now();
    const step = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setCount(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return count;
}

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

const cardHover = {
  rest: { scale: 1, y: 0 },
  hover: { 
    scale: 1.02, y: -4,
    transition: { type: 'spring' as const, stiffness: 400, damping: 20 }
  }
};

export function Dashboard() {
  const { tasks, goals, exams, studySessions, subjects, user } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Today's stats
  const todayStats = useMemo(() => {
    if (!mounted) return { studyMinutes: 0, sessionsCount: 0, tasksCompleted: 0, tasksDue: 0 };
    
    const today = new Date().toDateString();
    const todaySessions = studySessions.filter(
      (s) => new Date(s.started_at).toDateString() === today
    );
    const totalMinutes = todaySessions.reduce((acc, s) => acc + s.duration_minutes, 0);

    const todayTasks = tasks.filter(
      (t) => t.due_date && new Date(t.due_date).toDateString() === today
    );
    const completedToday = tasks.filter(
      (t) => t.completed_at && new Date(t.completed_at).toDateString() === today
    ).length;

    return {
      studyMinutes: totalMinutes,
      sessionsCount: todaySessions.length,
      tasksCompleted: completedToday,
      tasksDue: todayTasks.length,
    };
  }, [studySessions, tasks, mounted]);

  // Upcoming tasks - filter by selected date if any
  const upcomingTasks = useMemo(() => {
    let filtered = tasks.filter((t) => t.status !== 'completed' && t.due_date);
    
    // If a date is selected, filter to that date
    if (selectedDate) {
      const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
      filtered = filtered.filter((t) => {
        if (!t.due_date) return false;
        return format(new Date(t.due_date), 'yyyy-MM-dd') === selectedDateStr;
      });
    }
    
    return filtered
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
      .slice(0, 6);
  }, [tasks, selectedDate]);

  // Active goals
  const activeGoals = useMemo(() => {
    return goals.filter((g) => g.status === 'active').slice(0, 3);
  }, [goals]);

  // Upcoming exams
  const upcomingExams = useMemo(() => {
    if (!mounted) return [];
    // Compare at start-of-day so exams today still show as upcoming
    const todayStart = startOfDay(new Date());
    return exams
      .filter((e) => startOfDay(new Date(e.exam_date)) >= todayStart)
      .sort((a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime())
      .slice(0, 3);
  }, [exams, mounted]);

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

  const getEventsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayTasks = tasks.filter((task) => {
      if (!task.due_date) return false;
      return format(new Date(task.due_date), 'yyyy-MM-dd') === dateStr;
    });
    const dayExams = exams.filter((exam) => {
      return format(new Date(exam.exam_date), 'yyyy-MM-dd') === dateStr;
    });
    return { tasks: dayTasks, exams: dayExams };
  };

  return (
    <motion.div 
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      {/* Welcome Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}! 
            <motion.span
              animate={{ rotate: [0, 14, -8, 14, -4, 10, 0] }}
              transition={{ duration: 1.5, delay: 0.5, ease: 'easeInOut' }}
              className="inline-block origin-[70%_80%]"
            >
              👋
            </motion.span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {mounted ? format(new Date(), "EEEE, MMMM d, yyyy") : '\u00A0'}
          </p>
        </div>
        <Link href="/study">
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <Button size="default" className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/20 rounded-xl">
              <Play className="w-4 h-4" />
              Start Study Session
            </Button>
          </motion.div>
        </Link>
      </motion.div>

      {/* Stats Grid - Animated */}
      <motion.div variants={containerVariants} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Study Time Today', value: formatDuration(todayStats.studyMinutes), sub: `${todayStats.sessionsCount} sessions`, icon: Clock, color: 'indigo', gradient: 'from-indigo-500/10 to-blue-500/10', borderColor: 'border-indigo-500/20' },
          { label: 'Tasks Completed', value: String(todayStats.tasksCompleted), sub: `${todayStats.tasksDue} due today`, icon: CheckCircle2, color: 'green', gradient: 'from-green-500/10 to-emerald-500/10', borderColor: 'border-green-500/20' },
          { label: 'Current Streak', value: `${user?.current_streak || 0} days`, sub: `Best: ${user?.longest_streak || 0} days`, icon: Flame, color: 'orange', gradient: 'from-orange-500/10 to-amber-500/10', borderColor: 'border-orange-500/20' },
          { label: 'Active Goals', value: String(activeGoals.length), sub: `${goals.filter((g) => g.status === 'completed').length} completed`, icon: Target, color: 'purple', gradient: 'from-purple-500/10 to-pink-500/10', borderColor: 'border-purple-500/20' },
        ].map((stat, i) => (
          <motion.div key={stat.label} variants={itemVariants}>
            <motion.div initial="rest" whileHover="hover" variants={cardHover}>
              <Card className={cn(
                'overflow-hidden border bg-gradient-to-br backdrop-blur-sm transition-shadow hover:shadow-lg',
                stat.gradient, stat.borderColor
              )}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                      <p className="text-xl font-bold tracking-tight">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.sub}</p>
                    </div>
                    <motion.div 
                      className={`p-2.5 rounded-xl bg-${stat.color}-500/10`}
                      whileHover={{ rotate: [0, -10, 10, 0], transition: { duration: 0.5 } }}
                    >
                      <stat.icon className={`w-5 h-5 text-${stat.color}-500`} />
                    </motion.div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Main Content - Tasks on left, Calendar on right */}
      <motion.div variants={itemVariants} className="grid gap-4 lg:grid-cols-3">
        {/* Upcoming Tasks - Left side */}
        <div className="lg:col-span-2">
          <Card className="border-border/50 glow-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-500/10">
                    <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      {selectedDate ? `Tasks for ${format(selectedDate, 'MMM d')}` : 'Upcoming Tasks'}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {upcomingTasks.length} tasks {selectedDate ? 'on this date' : 'pending'}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedDate && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="gap-1 text-xs h-7"
                      onClick={() => setSelectedDate(null)}
                    >
                      <X className="w-3 h-3" />
                      Clear Filter
                    </Button>
                  )}
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
                    <p className="font-medium text-sm">All caught up!</p>
                    <p className="text-xs mb-3">No upcoming tasks. Great job! 🎉</p>
                    <Link href="/tasks">
                      <Button size="sm" variant="outline" className="gap-1">
                        <Plus className="w-3 h-3" />
                        Create Task
                      </Button>
                    </Link>
                  </motion.div>
                ) : (
                  <motion.div
                    key="tasks"
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                    className="space-y-2"
                  >
                    {upcomingTasks.map((task, i) => (
                      <motion.div
                        key={task.id}
                        variants={{
                          hidden: { opacity: 0, x: -10 },
                          show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
                        }}
                      >
                        <TaskCard task={task} compact />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>

        {/* Mini Calendar - Right side */}
        <div>
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
                  const dayEvents = getEventsForDate(day);
                  const hasEvents = dayEvents.tasks.length > 0 || dayEvents.exams.length > 0;
                  const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        'aspect-square text-xs rounded-lg flex flex-col items-center justify-center transition-all relative group/day',
                        !isCurrentMonth && 'opacity-30',
                        isToday(day) && 'bg-primary/20 border border-primary font-bold dot-pulse',
                        selectedDate && isSameDay(day, selectedDate) && 'bg-primary/10 ring-1 ring-primary/50',
                        !isToday(day) && 'hover:bg-muted hover:scale-110'
                      )}
                    >
                      {format(day, 'd')}
                      {hasEvents && (
                        <div className="absolute bottom-0.5 flex gap-0.5">
                          {dayEvents.tasks.slice(0, 2).map((t, i) => (
                            <div key={i} className={cn('w-1 h-1 rounded-full', isExamType(t.title, t.assignment_type) ? 'bg-purple-500' : 'bg-primary')} />
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

      {/* Bottom Section - Goals and Exams side by side */}
      <motion.div variants={itemVariants} className="grid gap-4 lg:grid-cols-2">
        {/* Goals Progress */}
        <Card className="border-border/50 glow-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/10">
                  <Target className="w-4 h-4 text-purple-500" />
                </div>
                <CardTitle className="text-base">Goals</CardTitle>
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
        <Card className="border-border/50 glow-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-red-500/10">
                  <GraduationCap className="w-4 h-4 text-red-500" />
                </div>
                <CardTitle className="text-base">Upcoming Exams</CardTitle>
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
                const daysUntil = getDaysUntil(exam.exam_date);
                const subject = subjects.find((s) => s.id === exam.subject_id);
                const isUrgent = daysUntil <= 7;

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
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
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
        <Card className="border-border/50">
          <CardContent className="p-3">
            <div className="grid grid-cols-4 gap-2">
              {[
                { href: '/tasks', icon: Plus, label: 'Add Task', color: 'green' },
                { href: '/study', icon: Clock, label: 'Study', color: 'indigo' },
                { href: '/goals', icon: Target, label: 'Set Goal', color: 'purple' },
                { href: '/calendar', icon: Calendar, label: 'Calendar', color: 'blue' },
              ].map((action) => (
                <Link key={action.href} href={action.href}>
                  <motion.div whileHover={{ scale: 1.05, y: -2 }} whileTap={{ scale: 0.97 }}>
                    <Button variant="outline" className={`w-full h-auto py-3 flex-col gap-1.5 hover:bg-${action.color}-500/10 hover:border-${action.color}-500/30 transition-all`}>
                      <action.icon className={`w-4 h-4 text-${action.color}-500`} />
                      <span className="text-xs font-medium">{action.label}</span>
                    </Button>
                  </motion.div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
