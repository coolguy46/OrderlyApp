'use client';

import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardDescription, ProgressBar } from '@/components/ui';
import { motion } from 'framer-motion';
import { formatDuration, cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart,
} from 'recharts';
import {
  format,
  subDays,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  parseISO,
} from 'date-fns';
import {
  Clock,
  Target,
  TrendingUp,
  Calendar,
  BookOpen,
  Award,
  Zap,
} from 'lucide-react';

export function Analytics() {
  const { studySessions, tasks, subjects, user } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Daily study time for the past 7 days
  const dailyData = useMemo(() => {
    if (!mounted) return [];
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => subDays(now, 6 - i));

    return days.map((day) => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const daySessions = studySessions.filter(
        (s) => format(parseISO(s.started_at), 'yyyy-MM-dd') === dayStr
      );
      const totalMinutes = daySessions.reduce((acc, s) => acc + s.duration_minutes, 0);

      return {
        name: format(day, 'EEE'),
        date: format(day, 'MMM d'),
        minutes: totalMinutes,
        hours: (totalMinutes / 60).toFixed(1),
      };
    });
  }, [studySessions, mounted]);

  // Study time by subject
  const subjectData = useMemo(() => {
    const subjectTimes: Record<string, number> = {};

    studySessions.forEach((session) => {
      const subjectId = session.subject_id || 'unassigned';
      subjectTimes[subjectId] = (subjectTimes[subjectId] || 0) + session.duration_minutes;
    });

    return Object.entries(subjectTimes).map(([id, minutes]) => {
      const subject = subjects.find((s) => s.id === id);
      return {
        name: subject?.name || 'Unassigned',
        value: minutes,
        color: subject?.color || '#6b7280',
      };
    });
  }, [studySessions, subjects]);

  // Task completion by priority
  const taskStats = useMemo(() => {
    const stats = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      high: {
        total: tasks.filter((t) => t.priority === 'high').length,
        completed: tasks.filter((t) => t.priority === 'high' && t.status === 'completed').length,
      },
      medium: {
        total: tasks.filter((t) => t.priority === 'medium').length,
        completed: tasks.filter((t) => t.priority === 'medium' && t.status === 'completed').length,
      },
      low: {
        total: tasks.filter((t) => t.priority === 'low').length,
        completed: tasks.filter((t) => t.priority === 'low' && t.status === 'completed').length,
      },
    };

    return stats;
  }, [tasks]);

  // Productivity by hour
  const hourlyData = useMemo(() => {
    const hourlyMinutes: Record<number, number> = {};

    studySessions.forEach((session) => {
      const hour = new Date(session.started_at).getHours();
      hourlyMinutes[hour] = (hourlyMinutes[hour] || 0) + session.duration_minutes;
    });

    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`,
      minutes: hourlyMinutes[i] || 0,
    }));
  }, [studySessions]);

  // Find peak productivity hour
  const peakHour = useMemo(() => {
    if (hourlyData.length === 0) return null;
    return hourlyData.reduce((max, curr) => (curr.minutes > max.minutes ? curr : max), hourlyData[0]);
  }, [hourlyData]);

  // Total stats
  const totalStats = useMemo(() => {
    const totalMinutes = studySessions.reduce((acc, s) => acc + s.duration_minutes, 0);
    const totalSessions = studySessions.length;
    const completionRate = tasks.length > 0 ? (taskStats.completed / tasks.length) * 100 : 0;

    return {
      totalMinutes,
      totalSessions,
      completionRate,
      avgSessionLength: totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0,
    };
  }, [studySessions, tasks, taskStats]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-xl">
          <p className="text-foreground font-medium">{label}</p>
          <p className="text-indigo-500 dark:text-indigo-400">
            {payload[0].value} minutes ({(payload[0].value / 60).toFixed(1)} hrs)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 backdrop-blur-xl border border-indigo-500/30 rounded-xl p-5"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500/20 dark:bg-indigo-500/30 rounded-xl">
              <Clock className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">
                {formatDuration(totalStats.totalMinutes)}
              </p>
              <p className="text-sm text-muted-foreground">Total Study Time</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 dark:from-green-500/20 dark:to-emerald-500/20 backdrop-blur-xl border border-green-500/30 rounded-xl p-5"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/20 dark:bg-green-500/30 rounded-xl">
              <Target className="w-6 h-6 text-green-500 dark:text-green-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">
                {Math.round(totalStats.completionRate)}%
              </p>
              <p className="text-sm text-muted-foreground">Task Completion</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 dark:from-yellow-500/20 dark:to-orange-500/20 backdrop-blur-xl border border-yellow-500/30 rounded-xl p-5"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-yellow-500/20 dark:bg-yellow-500/30 rounded-xl">
              <Zap className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">
                {totalStats.totalSessions}
              </p>
              <p className="text-sm text-muted-foreground">Study Sessions</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20 backdrop-blur-xl border border-purple-500/30 rounded-xl p-5"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/20 dark:bg-purple-500/30 rounded-xl">
              <Award className="w-6 h-6 text-purple-500 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">
                {user?.current_streak || 0} days
              </p>
              <p className="text-sm text-muted-foreground">Current Streak</p>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Study Time Chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-400" />
              <CardTitle>Study Time This Week</CardTitle>
            </div>
            <CardDescription>Daily study hours for the past 7 days</CardDescription>
          </CardHeader>
          <div className="h-72 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorMinutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" stroke="currentColor" opacity={0.2} />
                <XAxis
                  dataKey="name"
                  className="text-muted-foreground"
                  stroke="currentColor"
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                  tickLine={{ stroke: 'currentColor' }}
                />
                <YAxis
                  className="text-muted-foreground"
                  stroke="currentColor"
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                  tickLine={{ stroke: 'currentColor' }}
                  tickFormatter={(value) => `${value}m`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="minutes"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#colorMinutes)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Study Time by Subject */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-400" />
              <CardTitle>Time by Subject</CardTitle>
            </div>
            <CardDescription>Distribution of study time across subjects</CardDescription>
          </CardHeader>
          <div className="h-72 mt-4 flex items-center">
            <div className="w-1/2">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={subjectData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {subjectData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | undefined) => `${value ?? 0} min`}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-1/2 space-y-2">
              {subjectData.map((subject) => (
                <div key={subject.name} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: subject.color }}
                  />
                  <span className="text-sm text-foreground flex-1 truncate">
                    {subject.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatDuration(subject.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Task Completion by Priority */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-400" />
              <CardTitle>Task Completion</CardTitle>
            </div>
            <CardDescription>Progress by priority level</CardDescription>
          </CardHeader>
          <div className="space-y-6 mt-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  High Priority
                </span>
                <span className="text-sm text-muted-foreground">
                  {taskStats.high.completed}/{taskStats.high.total}
                </span>
              </div>
              <ProgressBar
                value={taskStats.high.completed}
                max={taskStats.high.total || 1}
                showLabel={false}
                color="red"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  Medium Priority
                </span>
                <span className="text-sm text-muted-foreground">
                  {taskStats.medium.completed}/{taskStats.medium.total}
                </span>
              </div>
              <ProgressBar
                value={taskStats.medium.completed}
                max={taskStats.medium.total || 1}
                showLabel={false}
                color="yellow"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Low Priority
                </span>
                <span className="text-sm text-muted-foreground">
                  {taskStats.low.completed}/{taskStats.low.total}
                </span>
              </div>
              <ProgressBar
                value={taskStats.low.completed}
                max={taskStats.low.total || 1}
                showLabel={false}
                color="green"
              />
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-foreground">Overall Completion</span>
                <span className="text-2xl font-bold text-foreground">
                  {Math.round(totalStats.completionRate)}%
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Productivity by Hour */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <CardTitle>Peak Productivity Hours</CardTitle>
            </div>
            <CardDescription>
              {peakHour
                ? `Your most productive time: ${peakHour.label}`
                : 'Start studying to see your patterns'}
            </CardDescription>
          </CardHeader>
          <div className="h-48 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData.filter((h) => h.hour >= 6 && h.hour <= 23)}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" stroke="currentColor" opacity={0.2} />
                <XAxis
                  dataKey="label"
                  className="text-muted-foreground"
                  stroke="currentColor"
                  tick={{ fill: 'currentColor', fontSize: 10 }}
                  tickLine={{ stroke: 'currentColor' }}
                  interval={2}
                />
                <YAxis
                  className="text-muted-foreground"
                  stroke="currentColor"
                  tick={{ fill: 'currentColor', fontSize: 10 }}
                  tickLine={{ stroke: 'currentColor' }}
                  tickFormatter={(value) => `${value}m`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="minutes" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Insights */}
      <Card>
        <CardHeader title="Quick Insights" />
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="p-4 bg-muted/50 rounded-xl text-center">
            <p className="text-3xl font-bold text-foreground mb-1">
              {totalStats.avgSessionLength}m
            </p>
            <p className="text-sm text-muted-foreground">Avg. Session Length</p>
          </div>
          <div className="p-4 bg-muted/50 rounded-xl text-center">
            <p className="text-3xl font-bold text-foreground mb-1">
              {peakHour?.label || '--'}
            </p>
            <p className="text-sm text-muted-foreground">Peak Study Hour</p>
          </div>
          <div className="p-4 bg-muted/50 rounded-xl text-center">
            <p className="text-3xl font-bold text-foreground mb-1">
              {user?.longest_streak || 0} days
            </p>
            <p className="text-sm text-muted-foreground">Longest Streak</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
