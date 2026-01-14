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
import { motion } from 'framer-motion';
import { formatDuration, getDaysUntil, cn } from '@/lib/utils';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  Clock,
  CheckCircle2,
  Target,
  Flame,
  Calendar,
  GraduationCap,
  TrendingUp,
  Play,
  ChevronRight,
  Plus,
} from 'lucide-react';

export function Dashboard() {
  const { tasks, goals, exams, studySessions, subjects, user } = useAppStore();
  const [mounted, setMounted] = useState(false);

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

  // Upcoming tasks
  const upcomingTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status !== 'completed' && t.due_date)
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
      .slice(0, 4);
  }, [tasks]);

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

  // Weekly study data
  const weeklyStudyData = useMemo(() => {
    if (!mounted) return [0, 0, 0, 0, 0, 0, 0];
    const days: number[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toDateString();
      
      const dayMinutes = studySessions
        .filter((s) => new Date(s.started_at).toDateString() === dateStr)
        .reduce((acc, s) => acc + s.duration_minutes, 0);

      days.push(dayMinutes);
    }

    return days;
  }, [studySessions, mounted]);

  const maxStudyDay = Math.max(...weeklyStudyData, 1);

  return (
    <div className="space-y-16">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}! 👋
          </h1>
          <p className="text-sm text-muted-foreground">
            {mounted ? format(new Date(), "EEEE, MMMM d, yyyy") : '\u00A0'}
          </p>
        </div>
        <Link href="/study">
          <Button size="lg" className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg rounded-xl">
            <Play className="w-4 h-4" />
            Start Study Session
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Study Time Today</p>
                <p className="text-2xl font-bold tracking-tight">{formatDuration(todayStats.studyMinutes)}</p>
                <p className="text-xs text-muted-foreground">{todayStats.sessionsCount} sessions</p>
              </div>
              <div className="p-3 rounded-xl bg-indigo-500/10">
                <Clock className="w-6 h-6 text-indigo-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Tasks Completed</p>
                <p className="text-2xl font-bold tracking-tight">{todayStats.tasksCompleted}</p>
                <p className="text-xs text-muted-foreground">{todayStats.tasksDue} due today</p>
              </div>
              <div className="p-3 rounded-xl bg-green-500/10">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Current Streak</p>
                <p className="text-2xl font-bold tracking-tight">{user?.current_streak || 0} days</p>
                <p className="text-xs text-muted-foreground">Best: {user?.longest_streak || 0} days</p>
              </div>
              <div className="p-3 rounded-xl bg-orange-500/10">
                <Flame className="w-6 h-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Active Goals</p>
                <p className="text-2xl font-bold tracking-tight">{activeGoals.length}</p>
                <p className="text-xs text-muted-foreground">
                  {goals.filter((g) => g.status === 'completed').length} completed
                </p>
              </div>
              <div className="p-3 rounded-xl bg-purple-500/10">
                <Target className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-24">
          {/* Upcoming Tasks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-500/10">
                    <CheckCircle2 className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div>
                    <CardTitle>Upcoming Tasks</CardTitle>
                    <CardDescription className="mt-0.5">{upcomingTasks.length} tasks pending</CardDescription>
                  </div>
                </div>
                <Link href="/tasks">
                  <Button variant="ghost" size="sm" className="gap-1">
                    View All
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {upcomingTasks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">All caught up!</p>
                  <p className="text-sm">No upcoming tasks. Great job! 🎉</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingTasks.map((task) => (
                    <TaskCard key={task.id} task={task} compact />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Weekly Activity */}
          <div className="pt-8">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-500/10">
                    <TrendingUp className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div>
                    <CardTitle>This Week's Activity</CardTitle>
                    <CardDescription className="mt-0.5">Daily study time overview</CardDescription>
                  </div>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-end justify-between h-40 gap-3 px-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                  const isToday = mounted && i === new Date().getDay();
                  const height = (weeklyStudyData[i] / maxStudyDay) * 100;

                  return (
                    <div key={day} className="flex-1 flex flex-col items-center gap-3">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(height, 6)}%` }}
                        transition={{ duration: 0.5, delay: i * 0.05 }}
                        className={cn(
                          'w-full rounded-lg min-h-[8px]',
                          isToday
                            ? 'bg-gradient-to-t from-indigo-500 to-purple-500'
                            : 'bg-muted hover:bg-muted/80 transition-colors'
                        )}
                      />
                      <span className={cn(
                        'text-xs font-medium',
                        isToday ? 'text-indigo-400' : 'text-muted-foreground'
                      )}>
                        {day}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <span className="text-sm text-muted-foreground">
                  Total: <span className="font-semibold text-foreground">{formatDuration(weeklyStudyData.reduce((a, b) => a + b, 0))}</span>
                </span>
                <Link href="/analytics">
                  <Button variant="ghost" size="sm" className="gap-1">
                    View Analytics
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Goals Progress */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Target className="w-5 h-5 text-purple-500" />
                  </div>
                  <CardTitle>Goals</CardTitle>
                </div>
                <Link href="/goals">
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {activeGoals.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Target className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No active goals</p>
                </div>
              ) : (
                activeGoals.map((goal) => {
                  const progress = Math.min(100, Math.round((goal.current_value / goal.target_value) * 100));
                  return (
                    <div key={goal.id} className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">
                          {goal.title}
                        </span>
                        <span className="text-sm font-semibold text-muted-foreground">
                          {progress}%
                        </span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Upcoming Exams */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/10">
                    <GraduationCap className="w-5 h-5 text-red-500" />
                  </div>
                  <CardTitle>Upcoming Exams</CardTitle>
                </div>
                <Link href="/exams">
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {upcomingExams.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GraduationCap className="w-10 h-10 mx-auto mb-2 opacity-50" />
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
                        'p-4 rounded-xl border transition-colors',
                        isUrgent ? 'bg-red-500/5 border-red-500/20' : 'bg-muted/30 hover:bg-muted/50'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="font-medium">{exam.title}</p>
                          {subject && (
                            <SubjectBadge name={subject.name} color={subject.color} />
                          )}
                        </div>
                        <Badge variant={isUrgent ? "destructive" : "secondary"} className="shrink-0">
                          {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                        </Badge>
                      </div>
                      <div className="mt-3">
                        <Progress value={exam.preparation_progress} className="h-1.5" />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-3">
                <Link href="/tasks">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-green-500/10 hover:border-green-500/30 transition-colors">
                    <Plus className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium">Add Task</span>
                  </Button>
                </Link>
                <Link href="/study">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-colors">
                    <Clock className="w-5 h-5 text-indigo-500" />
                    <span className="text-sm font-medium">Study</span>
                  </Button>
                </Link>
                <Link href="/goals">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-purple-500/10 hover:border-purple-500/30 transition-colors">
                    <Target className="w-5 h-5 text-purple-500" />
                    <span className="text-sm font-medium">Set Goal</span>
                  </Button>
                </Link>
                <Link href="/calendar">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-blue-500/10 hover:border-blue-500/30 transition-colors">
                    <Calendar className="w-5 h-5 text-blue-500" />
                    <span className="text-sm font-medium">Calendar</span>
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
