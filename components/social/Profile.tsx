'use client';

import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { ProgressBar, CircularProgress } from '@/components/ui/custom-progress';
import { motion } from 'framer-motion';
import { formatDuration, cn } from '@/lib/utils';
import {
  User,
  Award,
  Flame,
  Clock,
  Target,
  Trophy,
  Star,
  BookOpen,
  Calendar,
  TrendingUp,
} from 'lucide-react';

// Sample achievements
const ACHIEVEMENTS = [
  { id: '1', type: 'first_session', title: 'First Steps', description: 'Complete your first study session', icon: Star, unlocked: true },
  { id: '2', type: 'streak_7', title: 'Week Warrior', description: 'Maintain a 7-day streak', icon: Flame, unlocked: true },
  { id: '3', type: 'hours_10', title: 'Dedicated Learner', description: 'Study for 10 hours total', icon: Clock, unlocked: true },
  { id: '4', type: 'tasks_25', title: 'Task Master', description: 'Complete 25 tasks', icon: Target, unlocked: true },
  { id: '5', type: 'streak_30', title: 'Monthly Champion', description: 'Maintain a 30-day streak', icon: Trophy, unlocked: false },
  { id: '6', type: 'hours_100', title: 'Century Scholar', description: 'Study for 100 hours total', icon: BookOpen, unlocked: false },
];

export function Profile() {
  const { user, tasks, studySessions, goals, exams } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const stats = useMemo(() => {
    if (!mounted) return { totalStudyMinutes: 0, completedTasks: 0, activeGoals: 0, upcomingExams: 0, totalSessions: 0, avgDailyMinutes: 0 };
    
    const totalStudyMinutes = studySessions.reduce((acc, s) => acc + s.duration_minutes, 0);
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const activeGoals = goals.filter((g) => g.status === 'active').length;
    const upcomingExams = exams.filter((e) => new Date(e.exam_date) > new Date()).length;
    const totalSessions = studySessions.length;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSessions = studySessions.filter((s) => new Date(s.started_at) >= thirtyDaysAgo);
    const avgDailyMinutes = recentSessions.length > 0 ? Math.round(recentSessions.reduce((acc, s) => acc + s.duration_minutes, 0) / 30) : 0;

    return { totalStudyMinutes, completedTasks, activeGoals, upcomingExams, totalSessions, avgDailyMinutes };
  }, [tasks, studySessions, goals, exams, mounted]);

  const unlockedAchievements = ACHIEVEMENTS.filter((a) => a.unlocked).length;

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-purple-500/10 to-pink-500/20" />
        
        <CardContent className="relative p-6">
          <div className="flex items-center gap-6">
            {/* Avatar */}
            <div className="relative">
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30"
              >
                <span className="text-3xl font-bold text-white">{user?.full_name?.[0] || 'D'}</span>
              </motion.div>
              <div className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-yellow-500 flex items-center justify-center text-xs font-bold text-yellow-900 border-2 border-background">
                12
              </div>
            </div>

            {/* User Info */}
            <div className="flex-1">
              <h2 className="text-xl font-bold text-foreground">{user?.full_name || 'Demo Student'}</h2>
              <p className="text-muted-foreground text-sm">{user?.email}</p>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5 text-sm">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span className="text-foreground font-medium">{user?.current_streak || 0}</span>
                  <span className="text-muted-foreground">day streak</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  <span className="text-foreground font-medium">{unlockedAchievements}</span>
                  <span className="text-muted-foreground">achievements</span>
                </div>
              </div>
            </div>

            {/* XP Progress */}
            <div className="text-right hidden sm:block">
              <p className="text-sm text-muted-foreground">Level Progress</p>
              <p className="text-base font-bold text-foreground">2,450 / 3,000 XP</p>
              <div className="w-40 mt-2">
                <ProgressBar value={2450} max={3000} showLabel={false} color="indigo" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stats Grid */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl p-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Clock className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{formatDuration(stats.totalStudyMinutes)}</p>
                  <p className="text-xs text-muted-foreground">Total Study Time</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.01 }}
              className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-xl p-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <Target className="w-4 h-4 text-green-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{stats.completedTasks}</p>
                  <p className="text-xs text-muted-foreground">Tasks Completed</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.01 }}
              className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-purple-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{stats.totalSessions}</p>
                  <p className="text-xs text-muted-foreground">Study Sessions</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Achievements */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-yellow-500" />
                <CardTitle className="text-base">Achievements</CardTitle>
              </div>
              <CardDescription className="text-xs">{unlockedAchievements} of {ACHIEVEMENTS.length} unlocked</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {ACHIEVEMENTS.map((achievement) => (
                  <motion.div
                    key={achievement.id}
                    whileHover={{ scale: 1.01 }}
                    className={cn(
                      'p-3 rounded-xl border transition-all',
                      achievement.unlocked
                        ? 'bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30'
                        : 'bg-muted/50 border-border opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn('p-1.5 rounded-lg', achievement.unlocked ? 'bg-yellow-500/20' : 'bg-muted')}>
                        <achievement.icon className={cn('w-4 h-4', achievement.unlocked ? 'text-yellow-500' : 'text-muted-foreground')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium truncate', achievement.unlocked ? 'text-foreground' : 'text-muted-foreground')}>
                          {achievement.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{achievement.description}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Longest Streak</span>
                  <span className="text-foreground font-medium">{user?.longest_streak || 0} days</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Avg. Daily Study</span>
                  <span className="text-foreground font-medium">{formatDuration(stats.avgDailyMinutes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Active Goals</span>
                  <span className="text-foreground font-medium">{stats.activeGoals}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Upcoming Exams</span>
                  <span className="text-foreground font-medium">{stats.upcomingExams}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* This Week */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                <CardTitle className="text-base">This Week</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-4">
                <CircularProgress
                  value={stats.avgDailyMinutes * 7}
                  max={120 * 7}
                  size={100}
                  strokeWidth={8}
                  color="#6366f1"
                >
                  <div className="text-center">
                    <p className="text-base font-bold text-foreground">{formatDuration(stats.avgDailyMinutes * 7)}</p>
                    <p className="text-xs text-muted-foreground">this week</p>
                  </div>
                </CircularProgress>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-2">Goal: 14 hours per week</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
