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

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } }
};

const cardHover = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.03, y: -4, transition: { type: 'spring' as const, stiffness: 400, damping: 20 } }
};

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
        <div className="bg-card/95 backdrop-blur-xl border border-border rounded-xl p-3 shadow-2xl">
          <p className="text-foreground font-medium text-sm">{label}</p>
          <p className="text-indigo-500 dark:text-indigo-400 text-sm">
            {payload[0].value} minutes ({(payload[0].value / 60).toFixed(1)} hrs)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div 
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      {/* Summary Stats */}
      <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Study Time', value: formatDuration(totalStats.totalMinutes), icon: Clock, gradient: 'from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20', borderColor: 'border-indigo-500/30', iconBg: 'bg-indigo-500/20 dark:bg-indigo-500/30', iconColor: 'text-indigo-500 dark:text-indigo-400' },
          { label: 'Task Completion', value: `${Math.round(totalStats.completionRate)}%`, icon: Target, gradient: 'from-green-500/10 to-emerald-500/10 dark:from-green-500/20 dark:to-emerald-500/20', borderColor: 'border-green-500/30', iconBg: 'bg-green-500/20 dark:bg-green-500/30', iconColor: 'text-green-500 dark:text-green-400' },
          { label: 'Study Sessions', value: String(totalStats.totalSessions), icon: Zap, gradient: 'from-yellow-500/10 to-orange-500/10 dark:from-yellow-500/20 dark:to-orange-500/20', borderColor: 'border-yellow-500/30', iconBg: 'bg-yellow-500/20 dark:bg-yellow-500/30', iconColor: 'text-yellow-500 dark:text-yellow-400' },
          { label: 'Current Streak', value: `${user?.current_streak || 0} days`, icon: Award, gradient: 'from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20', borderColor: 'border-purple-500/30', iconBg: 'bg-purple-500/20 dark:bg-purple-500/30', iconColor: 'text-purple-500 dark:text-purple-400' },
        ].map((stat) => (
          <motion.div key={stat.label} variants={itemVariants}>
            <motion.div initial="rest" whileHover="hover" variants={cardHover}>
              <div className={cn(
                'bg-gradient-to-br backdrop-blur-xl border rounded-xl p-5',
                stat.gradient, stat.borderColor
              )}>
                <div className="flex items-center gap-4">
                  <motion.div 
                    className={cn('p-3 rounded-xl', stat.iconBg)}
                    whileHover={{ rotate: [0, -8, 8, 0], transition: { duration: 0.4 } }}
                  >
                    <stat.icon className={cn('w-6 h-6', stat.iconColor)} />
                  </motion.div>
                  <div>
                    <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={containerVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Study Time Chart */}
        <motion.div variants={itemVariants}>
          <Card className="glow-border">
            <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-400" />
              <CardTitle>Study Time This Week</CardTitle>
            </div>
            <CardDescription>Daily study hours for the past 7 days</CardDescription>
          </CardHeader>
          <div className="h-72 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorMinutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="name"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
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
        </motion.div>

        {/* Study Time by Subject */}
        <motion.div variants={itemVariants}>
        <Card className="glow-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-400" />
              <CardTitle>Time by Subject</CardTitle>
            </div>
            <CardDescription>Distribution of study time across subjects</CardDescription>
          </CardHeader>
          <div className="min-h-[288px] px-2 pb-4 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-full sm:w-1/2 h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
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
            <div className="w-full sm:w-1/2 space-y-2">
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
        </motion.div>

        {/* Task Completion by Priority */}
        <motion.div variants={itemVariants}>
        <Card className="glow-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-400" />
              <CardTitle>Task Completion</CardTitle>
            </div>
            <CardDescription>Progress by priority level</CardDescription>
          </CardHeader>
          <div className="space-y-6 px-6 pb-6">
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
        </motion.div>

        {/* Productivity by Hour */}
        <motion.div variants={itemVariants}>
        <Card className="glow-border">
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
          <div className="h-48 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData.filter((h) => h.hour >= 6 && h.hour <= 23)}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}m`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="minutes" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        </motion.div>
      </motion.div>

      {/* Insights */}
      <motion.div variants={itemVariants}>
      <Card className="glow-border">
        <CardHeader>
          <CardTitle>Quick Insights</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-6">
          {[
            { value: `${totalStats.avgSessionLength}m`, label: 'Avg. Session Length' },
            { value: peakHour?.label || '--', label: 'Peak Study Hour' },
            { value: `${user?.longest_streak || 0} days`, label: 'Longest Streak' },
          ].map((insight, i) => (
            <motion.div 
              key={insight.label}
              whileHover={{ scale: 1.03, y: -2 }}
              className="p-4 bg-muted/50 rounded-xl text-center"
            >
              <p className="text-3xl font-bold text-foreground mb-1">{insight.value}</p>
              <p className="text-sm text-muted-foreground">{insight.label}</p>
            </motion.div>
          ))}
        </div>
      </Card>
      </motion.div>
    </motion.div>
  );
}
