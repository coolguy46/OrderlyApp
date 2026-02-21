'use client';

import { useMemo, useState, useEffect } from 'react';
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
import { formatDuration, getDaysUntil, cn } from '@/lib/utils';
import { format, isSameDay, isToday, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns';
import Link from 'next/link';
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
} from 'lucide-react';

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
    const now = new Date();
    return exams
      .filter((e) => new Date(e.exam_date) >= now)
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
    return tasks.filter((task) => {
      if (!task.due_date) return false;
      return format(new Date(task.due_date), 'yyyy-MM-dd') === dateStr;
    });
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}! 👋
          </h1>
          <p className="text-sm text-muted-foreground">
            {mounted ? format(new Date(), "EEEE, MMMM d, yyyy") : '\u00A0'}
          </p>
        </div>
        <Link href="/study">
          <Button size="default" className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg rounded-xl">
            <Play className="w-4 h-4" />
            Start Study Session
          </Button>
        </Link>
      </div>

      {/* Stats Grid - More compact */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Study Time Today</p>
                <p className="text-xl font-bold tracking-tight">{formatDuration(todayStats.studyMinutes)}</p>
                <p className="text-xs text-muted-foreground">{todayStats.sessionsCount} sessions</p>
              </div>
              <div className="p-2.5 rounded-lg bg-indigo-500/10">
                <Clock className="w-5 h-5 text-indigo-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Tasks Completed</p>
                <p className="text-xl font-bold tracking-tight">{todayStats.tasksCompleted}</p>
                <p className="text-xs text-muted-foreground">{todayStats.tasksDue} due today</p>
              </div>
              <div className="p-2.5 rounded-lg bg-green-500/10">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Current Streak</p>
                <p className="text-xl font-bold tracking-tight">{user?.current_streak || 0} days</p>
                <p className="text-xs text-muted-foreground">Best: {user?.longest_streak || 0} days</p>
              </div>
              <div className="p-2.5 rounded-lg bg-orange-500/10">
                <Flame className="w-5 h-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Active Goals</p>
                <p className="text-xl font-bold tracking-tight">{activeGoals.length}</p>
                <p className="text-xs text-muted-foreground">
                  {goals.filter((g) => g.status === 'completed').length} completed
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-purple-500/10">
                <Target className="w-5 h-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content - Tasks on left, Calendar on right */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Upcoming Tasks - Left side */}
        <div className="lg:col-span-2">
          <Card className="border-border/50">
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
              {upcomingTasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="font-medium text-sm">All caught up!</p>
                  <p className="text-xs">No upcoming tasks. Great job! 🎉</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {upcomingTasks.map((task) => (
                    <TaskCard key={task.id} task={task} compact />
                  ))}
                </div>
              )}
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
                  const events = getEventsForDate(day);
                  const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        'aspect-square text-xs rounded flex flex-col items-center justify-center transition-all relative',
                        !isCurrentMonth && 'opacity-30',
                        isToday(day) && 'bg-primary/20 border border-primary font-bold',
                        selectedDate && isSameDay(day, selectedDate) && 'bg-primary/10',
                        !isToday(day) && 'hover:bg-muted'
                      )}
                    >
                      {format(day, 'd')}
                      {events.length > 0 && (
                        <div className="absolute bottom-0.5 flex gap-0.5">
                          {events.slice(0, 2).map((_, i) => (
                            <div key={i} className="w-1 h-1 rounded-full bg-primary" />
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
      </div>

      {/* Bottom Section - Goals and Exams side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Goals Progress */}
        <Card className="border-border/50">
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
                <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No active goals</p>
              </div>
            ) : (
              activeGoals.map((goal) => {
                const progress = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100));
                return (
                  <div key={goal.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{goal.title}</span>
                      <span className="text-xs font-semibold text-muted-foreground">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-1.5" />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Upcoming Exams */}
        <Card className="border-border/50">
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
                <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No upcoming exams</p>
              </div>
            ) : (
              upcomingExams.map((exam) => {
                const daysUntil = getDaysUntil(exam.exam_date);
                const subject = subjects.find((s) => s.id === exam.subject_id);
                const isUrgent = daysUntil <= 7;

                return (
                  <div
                    key={exam.id}
                    className={cn(
                      'p-3 rounded-lg border transition-colors',
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
                      <Badge variant={isUrgent ? "destructive" : "secondary"} className="shrink-0 text-xs">
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </Badge>
                    </div>
                    <div className="mt-2">
                      <Progress value={exam.preparation_progress} className="h-1" />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions - Smaller */}
      <Card className="border-border/50">
        <CardContent className="p-3">
          <div className="grid grid-cols-4 gap-2">
            <Link href="/tasks">
              <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-green-500/10 hover:border-green-500/30 transition-colors">
                <Plus className="w-4 h-4 text-green-500" />
                <span className="text-xs font-medium">Add Task</span>
              </Button>
            </Link>
            <Link href="/study">
              <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-colors">
                <Clock className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-medium">Study</span>
              </Button>
            </Link>
            <Link href="/goals">
              <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-purple-500/10 hover:border-purple-500/30 transition-colors">
                <Target className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium">Set Goal</span>
              </Button>
            </Link>
            <Link href="/calendar">
              <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-blue-500/10 hover:border-blue-500/30 transition-colors">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium">Calendar</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
