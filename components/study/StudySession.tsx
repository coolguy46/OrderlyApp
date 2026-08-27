'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { PomodoroTimer } from './PomodoroTimer';
import { EggHatching, IceMelting } from './GamifiedProgress';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TaskCard } from '@/components/tasks';
import { motion } from 'framer-motion';
import { formatDuration } from '@/lib/utils';
import { useCurrentTime } from '@/lib/use-current-time';
import { usePlannerStore } from '@/lib/planner/store';
import { localDateFromIso } from '@/lib/schedule/selectors';
import {
  discardUnownedLegacyStorageValue,
  userScopedStorageKey,
} from '@/lib/user-scoped-storage';
import { useHydrated } from '@/lib/use-hydrated';
import {
  Egg,
  Snowflake,
  Settings,
  CheckCircle2,
} from 'lucide-react';

type VisualizationType = 'egg' | 'ice';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export function StudySession() {
  const { studySessions, tasks, pomodoroSettings, activeStudySeconds, user } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const currentTime = useCurrentTime();
  const timeZone = (user?.id ? plannerUsers[user.id]?.settings.timeZone : null)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const [visualType, setVisualType] = useState<VisualizationType>('egg');
  const [preferencesLoadedForUserId, setPreferencesLoadedForUserId] = useState('');
  const mounted = useHydrated();
  
  // Editable goal duration (in hours, min 1, max 24)
  const [goalHours, setGoalHours] = useState(2);
  const [showGoalSettings, setShowGoalSettings] = useState(false);
  const [tempGoalHours, setTempGoalHours] = useState('2');
  const [tempGoalMinutes, setTempGoalMinutes] = useState('0');

  const preferenceOwner = mounted ? user?.id || '' : '';
  if (preferencesLoadedForUserId !== preferenceOwner) {
    discardUnownedLegacyStorageValue(localStorage, 'studyVisualType');
    discardUnownedLegacyStorageValue(localStorage, 'studyGoalHours');
    const visualKey = userScopedStorageKey('studyVisualType', preferenceOwner);
    const goalKey = userScopedStorageKey('studyGoalHours', preferenceOwner);
    const savedVisual = visualKey ? localStorage.getItem(visualKey) : null;
    const savedGoal = goalKey ? localStorage.getItem(goalKey) : null;
    const parsedGoal = savedGoal ? Number.parseFloat(savedGoal) : Number.NaN;
    setVisualType(savedVisual === 'ice' ? 'ice' : 'egg');
    setGoalHours(Number.isFinite(parsedGoal) && parsedGoal >= 1 && parsedGoal <= 24 ? parsedGoal : 2);
    setPreferencesLoadedForUserId(preferenceOwner);
  }

  // Persist visualization type
  useEffect(() => {
    const storageKey = userScopedStorageKey('studyVisualType', user?.id);
    if (mounted && storageKey && preferencesLoadedForUserId === user?.id) {
      localStorage.setItem(storageKey, visualType);
    }
  }, [visualType, mounted, preferencesLoadedForUserId, user?.id]);

  // Save goal to localStorage
  useEffect(() => {
    const storageKey = userScopedStorageKey('studyGoalHours', user?.id);
    if (mounted && storageKey && preferencesLoadedForUserId === user?.id) {
      localStorage.setItem(storageKey, goalHours.toString());
    }
  }, [goalHours, mounted, preferencesLoadedForUserId, user?.id]);

  // Calculate today's study time
  const todayStats = useMemo(() => {
    if (!mounted) return { totalMinutes: 0 };
    const today = localDateFromIso(currentTime.toISOString(), timeZone);
    const todaySessions = studySessions.filter(
      (s) => localDateFromIso(s.started_at, timeZone) === today
    );
    const savedMinutes = todaySessions.reduce((acc, s) => acc + s.duration_minutes, 0);
    const totalMinutes = savedMinutes + Math.floor(activeStudySeconds / 60);
    return { totalMinutes };
  }, [studySessions, mounted, activeStudySeconds, currentTime, timeZone]);

  // Daily goal progress
  const dailyGoal = goalHours * 60; // Convert hours to minutes
  const dailyProgress = Math.min(100, (todayStats.totalMinutes / dailyGoal) * 100);

  // Pending tasks
  const pendingTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      })
      .slice(0, 5);
  }, [tasks]);

  const handleSaveGoal = () => {
    const hours = parseInt(tempGoalHours) || 0;
    const minutes = parseInt(tempGoalMinutes) || 0;
    const totalHours = hours + minutes / 60;
    
    // Clamp between 1 and 24 hours
    const clampedHours = Math.max(1, Math.min(24, totalHours));
    setGoalHours(clampedHours);
    setShowGoalSettings(false);
  };

  const openGoalSettings = () => {
    const hours = Math.floor(goalHours);
    const minutes = Math.round((goalHours - hours) * 60);
    setTempGoalHours(hours.toString());
    setTempGoalMinutes(minutes.toString());
    setShowGoalSettings(true);
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <div>
          <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pomodoro Timer */}
            <div>
              <PomodoroTimer />
            </div>

            {/* Gamified Progress */}
            <Card className="glow-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Daily Progress</CardTitle>
                    <CardDescription className="text-xs">
                      Study {goalHours >= 1 ? `${Math.floor(goalHours)}h` : ''}{goalHours % 1 !== 0 ? ` ${Math.round((goalHours % 1) * 60)}m` : goalHours >= 1 ? '' : `${Math.round(goalHours * 60)}m`} to {visualType === 'egg' ? 'hatch the egg' : 'melt the ice'}
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openGoalSettings}>
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <button
                    onClick={() => setVisualType('egg')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      visualType === 'egg'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Egg className="w-3 h-3" />
                    Hatch Egg
                  </button>
                  <button
                    onClick={() => setVisualType('ice')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      visualType === 'ice'
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Snowflake className="w-3 h-3" />
                    Melt Ice
                  </button>
                </div>

                <div className="flex items-center justify-center py-2">
                  {visualType === 'egg' ? (
                    <EggHatching progress={dailyProgress} size={180} />
                  ) : (
                    <IceMelting progress={dailyProgress} size={180} />
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground text-center mb-3">
                    Study {formatDuration(Math.max(0, dailyGoal - todayStats.totalMinutes))} more to reach your goal
                  </p>
                  <div className="flex items-center justify-center gap-3 text-center">
                    <div>
                      <p className="text-sm font-bold text-foreground">{pomodoroSettings.focusDuration}m</p>
                      <p className="text-[10px] text-muted-foreground">Focus</p>
                    </div>
                    <div className="w-px h-6 bg-border" />
                    <div>
                      <p className="text-sm font-bold text-foreground">{pomodoroSettings.shortBreakDuration}m</p>
                      <p className="text-[10px] text-muted-foreground">Break</p>
                    </div>
                    <div className="w-px h-6 bg-border" />
                    <div>
                      <p className="text-sm font-bold text-foreground">{pomodoroSettings.sessionsBeforeLongBreak}</p>
                      <p className="text-[10px] text-muted-foreground">Sessions</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Pending Tasks */}
          <motion.div variants={itemVariants} className="mt-4">
            <Card className="glow-border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <CardTitle className="text-base">Tasks to Complete</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {pendingTasks.length > 0 ? (
                    pendingTasks.map((task) => (
                      <TaskCard key={task.id} task={task} compact currentTime={currentTime} timeZone={timeZone} />
                    ))
                  ) : (
                    <p className="text-center text-muted-foreground py-6 text-sm">
                      No pending tasks. Great job! 🎉
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
      </div>

      {/* Goal Settings Modal */}
      <Dialog open={showGoalSettings} onOpenChange={(open) => !open && setShowGoalSettings(false)}>
        <DialogContent className="sm:max-w-[300px]">
          <DialogHeader>
            <DialogTitle className="text-lg">Set Daily Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Set how long you want to study each day (minimum 1 hour, maximum 24 hours)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-sm">Hours</Label>
                <Input
                  type="number"
                  min="0"
                  max="24"
                  value={tempGoalHours}
                  onChange={(e) => setTempGoalHours(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Minutes</Label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={tempGoalMinutes}
                  onChange={(e) => setTempGoalMinutes(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowGoalSettings(false)} className="flex-1 h-8">
                Cancel
              </Button>
              <Button onClick={handleSaveGoal} className="flex-1 h-8">
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
