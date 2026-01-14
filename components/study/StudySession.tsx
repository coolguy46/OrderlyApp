'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { PomodoroTimer } from './PomodoroTimer';
import { EggHatching, IceMelting } from './GamifiedProgress';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { motion } from 'framer-motion';
import { formatDuration } from '@/lib/utils';
import {
  Timer,
  Flame,
  Clock,
  TrendingUp,
  Egg,
  Snowflake,
} from 'lucide-react';

type VisualizationType = 'egg' | 'ice';

export function StudySession() {
  const { studySessions, user, pomodoroSettings } = useAppStore();
  const [visualType, setVisualType] = useState<VisualizationType>('egg');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Calculate today's study time
  const todayStats = useMemo(() => {
    if (!mounted) return { totalMinutes: 0, sessionCount: 0 };
    const today = new Date().toDateString();
    const todaySessions = studySessions.filter(
      (s) => new Date(s.started_at).toDateString() === today
    );
    const totalMinutes = todaySessions.reduce((acc, s) => acc + s.duration_minutes, 0);
    const sessionCount = todaySessions.length;

    return { totalMinutes, sessionCount };
  }, [studySessions, mounted]);

  // Calculate weekly study time
  const weeklyStats = useMemo(() => {
    if (!mounted) return { totalMinutes: 0, sessionCount: 0 };
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const weeklySessions = studySessions.filter(
      (s) => new Date(s.started_at) >= weekAgo
    );
    const totalMinutes = weeklySessions.reduce((acc, s) => acc + s.duration_minutes, 0);
    
    return { totalMinutes, sessionCount: weeklySessions.length };
  }, [studySessions, mounted]);

  // Daily goal progress (default: 2 hours = 120 minutes)
  const dailyGoal = 120;
  const dailyProgress = Math.min(100, (todayStats.totalMinutes / dailyGoal) * 100);

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-card/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <Timer className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {formatDuration(todayStats.totalMinutes)}
              </p>
              <p className="text-xs text-muted-foreground">Today</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-card/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Clock className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{todayStats.sessionCount}</p>
              <p className="text-xs text-muted-foreground">Sessions Today</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-card/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {formatDuration(weeklyStats.totalMinutes)}
              </p>
              <p className="text-xs text-muted-foreground">This Week</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          className="bg-card/50 backdrop-blur-xl border border-border rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Flame className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{user?.current_streak || 0}</p>
              <p className="text-xs text-muted-foreground">Day Streak</p>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pomodoro Timer */}
        <div>
          <PomodoroTimer />
        </div>

        {/* Gamified Progress */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Progress</CardTitle>
            <CardDescription>Complete 2 hours of study to reach your goal</CardDescription>
          </CardHeader>
          <CardContent>

          {/* Visualization Type Toggle */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <button
              onClick={() => setVisualType('egg')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                visualType === 'egg'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Egg className="w-4 h-4" />
              Hatch Egg
            </button>
            <button
              onClick={() => setVisualType('ice')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                visualType === 'ice'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Snowflake className="w-4 h-4" />
              Melt Ice
            </button>
          </div>

          {/* Visualization */}
          <div className="flex items-center justify-center py-4">
            {visualType === 'egg' ? (
              <EggHatching progress={dailyProgress} size={220} />
            ) : (
              <IceMelting progress={dailyProgress} size={220} />
            )}
          </div>

          {/* Study Time Breakdown */}
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground text-center mb-4">
              Study {formatDuration(Math.max(0, dailyGoal - todayStats.totalMinutes))} more to reach your goal
            </p>
            
            <div className="flex items-center justify-center gap-4">
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{pomodoroSettings.focusDuration}m</p>
                <p className="text-xs text-muted-foreground">Focus</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{pomodoroSettings.shortBreakDuration}m</p>
                <p className="text-xs text-muted-foreground">Break</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{pomodoroSettings.sessionsBeforeLongBreak}</p>
                <p className="text-xs text-muted-foreground">Sessions</p>
              </div>
            </div>
          </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Sessions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Study Sessions</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="space-y-3">
          {studySessions
            .slice(-5)
            .reverse()
            .map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/20 rounded-lg">
                    <Timer className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {session.duration_minutes} minutes
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.started_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground capitalize px-2 py-1 bg-muted rounded-lg">
                  {session.session_type.replace('_', ' ')}
                </span>
              </div>
            ))}
          {studySessions.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No study sessions yet. Start your first session!
            </p>
          )}
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
