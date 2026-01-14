'use client';

import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardHeader, ProgressBar, CircularProgress } from '@/components/ui';
import { motion } from 'framer-motion';
import { formatDuration } from '@/lib/utils';
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

    // Calculate average study time per day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSessions = studySessions.filter((s) => new Date(s.started_at) >= thirtyDaysAgo);
    const daysWithStudy = new Set(recentSessions.map((s) => new Date(s.started_at).toDateString())).size;
    const avgDailyMinutes = daysWithStudy > 0 ? Math.round(recentSessions.reduce((acc, s) => acc + s.duration_minutes, 0) / 30) : 0;

    return {
      totalStudyMinutes,
      completedTasks,
      activeGoals,
      upcomingExams,
      totalSessions,
      avgDailyMinutes,
    };
  }, [tasks, studySessions, goals, exams, mounted]);

  const unlockedAchievements = ACHIEVEMENTS.filter((a) => a.unlocked).length;

  return (
    <div className="space-y-8">
      {/* Profile Header */}
      <Card className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-pink-500/20" />
        
        <div className="relative flex items-center gap-6 p-6">
          {/* Avatar */}
          <div className="relative">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30"
            >
              <span className="text-4xl font-bold text-white">
                {user?.full_name?.[0] || 'D'}
              </span>
            </motion.div>
            {/* Level badge */}
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-yellow-500 flex items-center justify-center text-sm font-bold text-yellow-900 border-2 border-gray-900">
              12
            </div>
          </div>

          {/* User Info */}
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white">{user?.full_name || 'Demo Student'}</h2>
            <p className="text-gray-400">{user?.email}</p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2 text-sm">
                <Flame className="w-4 h-4 text-orange-400" />
                <span className="text-white font-medium">{user?.current_streak || 0}</span>
                <span className="text-gray-400">day streak</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <span className="text-white font-medium">{unlockedAchievements}</span>
                <span className="text-gray-400">achievements</span>
              </div>
            </div>
          </div>

          {/* XP Progress */}
          <div className="text-right">
            <p className="text-sm text-gray-400">Level Progress</p>
            <p className="text-lg font-bold text-white">2,450 / 3,000 XP</p>
            <div className="w-48 mt-2">
              <ProgressBar value={2450} max={3000} showLabel={false} color="gradient" />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Stats Grid */}
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-3 gap-6">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 backdrop-blur-xl border border-indigo-500/20 rounded-xl p-5"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Clock className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">
                    {formatDuration(stats.totalStudyMinutes)}
                  </p>
                  <p className="text-xs text-gray-400">Total Study Time</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 backdrop-blur-xl border border-green-500/20 rounded-xl p-5"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <Target className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stats.completedTasks}</p>
                  <p className="text-xs text-gray-400">Tasks Completed</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 backdrop-blur-xl border border-purple-500/20 rounded-xl p-5"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stats.totalSessions}</p>
                  <p className="text-xs text-gray-400">Study Sessions</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Achievements */}
          <Card>
            <CardHeader
              title="Achievements"
              subtitle={`${unlockedAchievements} of ${ACHIEVEMENTS.length} unlocked`}
              icon={<Award className="w-5 h-5 text-yellow-400" />}
            />
            <div className="grid grid-cols-3 gap-5 mt-6">
              {ACHIEVEMENTS.map((achievement) => (
                <motion.div
                  key={achievement.id}
                  whileHover={{ scale: 1.02 }}
                  className={`p-5 rounded-xl border transition-all ${
                    achievement.unlocked
                      ? 'bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30'
                      : 'bg-white/5 border-white/10 opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-2 rounded-lg ${
                        achievement.unlocked ? 'bg-yellow-500/20' : 'bg-white/10'
                      }`}
                    >
                      <achievement.icon
                        className={`w-5 h-5 ${
                          achievement.unlocked ? 'text-yellow-400' : 'text-gray-500'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          achievement.unlocked ? 'text-white' : 'text-gray-400'
                        }`}
                      >
                        {achievement.title}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {achievement.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          {/* Quick Stats */}
          <Card>
            <CardHeader title="Quick Stats" />
            <div className="space-y-5 mt-6">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Longest Streak</span>
                <span className="text-white font-medium">
                  {user?.longest_streak || 0} days
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Avg. Daily Study</span>
                <span className="text-white font-medium">
                  {formatDuration(stats.avgDailyMinutes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Active Goals</span>
                <span className="text-white font-medium">{stats.activeGoals}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Upcoming Exams</span>
                <span className="text-white font-medium">{stats.upcomingExams}</span>
              </div>
            </div>
          </Card>

          {/* This Week */}
          <Card>
            <CardHeader title="This Week" icon={<Calendar className="w-5 h-5 text-indigo-400" />} />
            <div className="flex items-center justify-center mt-6">
              <CircularProgress
                value={stats.avgDailyMinutes * 7}
                max={120 * 7}
                size={120}
                strokeWidth={10}
                color="#6366f1"
              >
                <div className="text-center">
                  <p className="text-lg font-bold text-white">
                    {formatDuration(stats.avgDailyMinutes * 7)}
                  </p>
                  <p className="text-xs text-gray-400">this week</p>
                </div>
              </CircularProgress>
            </div>
            <p className="text-center text-sm text-gray-400 mt-4">
              Goal: 14 hours per week
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
