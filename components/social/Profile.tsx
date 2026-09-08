'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui';
import { ProgressBar, CircularProgress } from '@/components/ui/custom-progress';
import { motion } from 'framer-motion';
import { formatDuration } from '@/lib/utils';
import { examTemporalStatus } from '@/lib/exam-status';
import { isGoalComplete } from '@/lib/goal-status';
import { useCurrentTime } from '@/lib/use-current-time';
import { usePlannerStore } from '@/lib/planner/store';
import { useHydrated } from '@/lib/use-hydrated';
import {
  Clock,
  Target,
  Calendar,
  TrendingUp,
  Edit3,
} from 'lucide-react';

// XP calculation from real stats
function calculateXP(profile: { tasks_completed: number; total_study_time: number }): number {
  return (
    profile.tasks_completed * 10 +
    Math.floor(profile.total_study_time / 10) * 5
  );
}

function getLevel(xp: number): { level: number; currentXP: number; nextLevelXP: number } {
  // Each level requires 20% more XP than the last, starting at 100
  let level = 1;
  let threshold = 100;
  let accumulated = 0;

  while (xp >= accumulated + threshold) {
    accumulated += threshold;
    level++;
    threshold = Math.floor(threshold * 1.2);
  }

  return { level, currentXP: xp - accumulated, nextLevelXP: threshold };
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } }
};

export function Profile() {
  const { user, tasks, studySessions, goals, exams, updateUserProfile } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const now = useCurrentTime();
  const timeZone = (user?.id ? plannerUsers[user.id]?.settings.timeZone : null)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const mounted = useHydrated();
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editorOwner, setEditorOwner] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const editSessionRef = useRef(0);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (!editorOwner || editorOwner === user?.id) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      editSessionRef.current += 1;
      saveInFlightRef.current = false;
      setIsSaving(false);
      setEditOpen(false);
      setEditName('');
      setSaveError('');
      setEditorOwner(null);
    });
    return () => { cancelled = true; };
  }, [editorOwner, user?.id]);

  const stats = useMemo(() => {
    if (!mounted) return { totalStudyMinutes: 0, completedTasks: 0, activeGoals: 0, upcomingExams: 0, totalSessions: 0, avgDailyMinutes: 0, weeklyMinutes: 0 };

    const totalStudyMinutes = studySessions.reduce((acc, s) => acc + s.duration_minutes, 0);
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const activeGoals = goals.filter((g) => g.status === 'active' && !isGoalComplete(g)).length;
    const upcomingExams = exams.filter(
      (exam) => examTemporalStatus(exam, now, timeZone) === 'upcoming'
    ).length;
    const totalSessions = studySessions.length;

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSessions = studySessions.filter((s) => new Date(s.started_at) >= thirtyDaysAgo);
    const avgDailyMinutes = recentSessions.length > 0 ? Math.round(recentSessions.reduce((acc, s) => acc + s.duration_minutes, 0) / 30) : 0;

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekSessions = studySessions.filter((s) => new Date(s.started_at) >= sevenDaysAgo);
    const weeklyMinutes = weekSessions.reduce((acc, s) => acc + s.duration_minutes, 0);

    return { totalStudyMinutes, completedTasks, activeGoals, upcomingExams, totalSessions, avgDailyMinutes, weeklyMinutes };
  }, [tasks, studySessions, goals, exams, mounted, now, timeZone]);

  // Real XP & level
  const xp = useMemo(() => {
    if (!user) return 0;
    return calculateXP(user);
  }, [user]);

  const levelInfo = useMemo(() => getLevel(xp), [xp]);

  const closeEditor = () => {
    editSessionRef.current += 1;
    saveInFlightRef.current = false;
    setIsSaving(false);
    setEditOpen(false);
  };

  const handleSaveProfile = async () => {
    if (saveInFlightRef.current || !editorOwner || editorOwner !== user?.id) return;
    if (!editName.trim()) { setSaveError('Enter your name.'); return; }
    const owner = user.id;
    const session = editSessionRef.current;
    saveInFlightRef.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      const saved = await updateUserProfile({ full_name: editName.trim() });
      if (session !== editSessionRef.current || useAppStore.getState().user?.id !== owner) return;
      if (saved) closeEditor();
      else setSaveError('Your name was not saved. Your changes are still here—please try again.');
    } catch {
      if (session === editSessionRef.current && useAppStore.getState().user?.id === owner) {
        setSaveError('Your name was not saved. Your changes are still here—please try again.');
      }
    } finally {
      if (session === editSessionRef.current) {
        saveInFlightRef.current = false;
        setIsSaving(false);
      }
    }
  };

  return (
    <motion.div 
      className="workspace-page mx-auto max-w-5xl"
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      <div className="workspace-header">
        <div>
          <p className="workspace-eyebrow">Your journey</p>
          <h1 className="workspace-title">Profile</h1>
          <p className="workspace-description">A clear view of your progress, one day at a time.</p>
        </div>
      </div>
      {/* Profile Header */}
      <motion.div variants={itemVariants}>
      <Card className="relative overflow-hidden">
        <CardContent className="relative p-6 sm:p-7">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Avatar */}
            <div className="relative">
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center"
              >
                <span className="text-3xl font-semibold text-primary">{user?.full_name?.[0] || 'U'}</span>
              </motion.div>
              <motion.div 
                className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-card flex items-center justify-center text-xs font-semibold text-foreground border border-border"
              >
                {levelInfo.level}
              </motion.div>
            </div>

            {/* User Info */}
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <h2 className="text-xl font-bold text-foreground">{user?.full_name || 'Student'}</h2>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit profile name"
                  onClick={() => {
                    editSessionRef.current += 1;
                    saveInFlightRef.current = false;
                    setIsSaving(false);
                    setSaveError('');
                    setEditorOwner(user?.id || null);
                    setEditName(user?.full_name || '');
                    setEditOpen(true);
                  }}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-muted-foreground text-sm break-all">{user?.email}</p>
              <div className="flex items-center gap-4 mt-2 justify-center sm:justify-start">
                <div className="flex items-center gap-1.5 text-sm">
                  <Target className="w-4 h-4 text-green-500" />
                  <span className="text-foreground font-medium">{stats.completedTasks}</span>
                  <span className="text-muted-foreground">tasks completed</span>
                </div>
              </div>
            </div>

            {/* XP Progress */}
            <div className="rounded-xl bg-muted/40 p-4 text-center sm:text-right">
              <p className="text-sm text-muted-foreground">Level {levelInfo.level}</p>
              <p className="text-base font-bold text-foreground">
                {levelInfo.currentXP.toLocaleString()} / {levelInfo.nextLevelXP.toLocaleString()} XP
              </p>
              <div className="w-40 mt-2">
                <ProgressBar value={levelInfo.currentXP} max={levelInfo.nextLevelXP} showLabel={false} color="indigo" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{xp.toLocaleString()} total XP</p>
            </div>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <div className="space-y-5">
        {/* Stats Grid */}
        <div>
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <motion.div
              className="workspace-stat"
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
              className="workspace-stat"
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
              className="workspace-stat"
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
          </motion.div>

        </div>

        {/* Right Column */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Study This Week</span>
                  <span className="text-foreground font-medium">{formatDuration(stats.weeklyMinutes)}</span>
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
                  value={stats.weeklyMinutes}
                  max={840}
                  size={100}
                  strokeWidth={8}
                  color="#6366f1"
                >
                  <div className="text-center">
                    <p className="text-base font-bold text-foreground">{formatDuration(stats.weeklyMinutes)}</p>
                    <p className="text-xs text-muted-foreground">this week</p>
                  </div>
                </CircularProgress>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-2">Goal: 14 hours per week</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen && editorOwner === user?.id} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update your display name</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            {saveError && <p role="alert" className="text-sm text-red-400">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeEditor}>Cancel</Button>
              <Button onClick={handleSaveProfile} disabled={isSaving} aria-busy={isSaving}>{isSaving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
