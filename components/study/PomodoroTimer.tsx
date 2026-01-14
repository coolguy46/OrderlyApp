'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { CircularProgress } from '@/components/ui/custom-progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatDuration } from '@/lib/utils';
import {
  Play,
  Pause,
  RotateCcw,
  Settings,
  Coffee,
  Brain,
  Zap,
  Volume2,
  VolumeX,
} from 'lucide-react';

type TimerMode = 'focus' | 'shortBreak' | 'longBreak';

interface PomodoroTimerProps {
  selectedSubjectId?: string | null;
  selectedTaskId?: string | null;
}

export function PomodoroTimer({ selectedSubjectId, selectedTaskId }: PomodoroTimerProps) {
  const { pomodoroSettings, updatePomodoroSettings, addStudySession, subjects, user } = useAppStore();
  
  const [mode, setMode] = useState<TimerMode>('focus');
  const [timeLeft, setTimeLeft] = useState(pomodoroSettings.focusDuration * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionsCompleted, setSessions] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [subjectId, setSubjectId] = useState(selectedSubjectId || '');
  
  const startTimeRef = useRef<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const getDuration = useCallback((timerMode: TimerMode) => {
    switch (timerMode) {
      case 'focus':
        return pomodoroSettings.focusDuration * 60;
      case 'shortBreak':
        return pomodoroSettings.shortBreakDuration * 60;
      case 'longBreak':
        return pomodoroSettings.longBreakDuration * 60;
    }
  }, [pomodoroSettings]);

  // Reset timer when mode or settings change
  useEffect(() => {
    setTimeLeft(getDuration(mode));
  }, [mode, getDuration]);

  // Timer logic
  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isRunning) {
      // Timer completed
      handleTimerComplete();
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timeLeft]);

  const handleTimerComplete = () => {
    setIsRunning(false);
    
    // Play notification sound
    if (soundEnabled && typeof Audio !== 'undefined') {
      const audio = new Audio('/notification.mp3');
      audio.play().catch(() => {});
    }

    if (mode === 'focus') {
      // Save study session
      const duration = pomodoroSettings.focusDuration;
      addStudySession({
        user_id: user?.id || 'demo-user-id',
        subject_id: subjectId || null,
        task_id: selectedTaskId || null,
        duration_minutes: duration,
        session_type: 'pomodoro',
        started_at: startTimeRef.current?.toISOString() || new Date().toISOString(),
        ended_at: new Date().toISOString(),
        notes: null,
      });

      const newSessions = sessionsCompleted + 1;
      setSessions(newSessions);

      // Determine next break type
      if (newSessions % pomodoroSettings.sessionsBeforeLongBreak === 0) {
        setMode('longBreak');
      } else {
        setMode('shortBreak');
      }
    } else {
      // After break, go back to focus
      setMode('focus');
    }

    startTimeRef.current = null;
  };

  const handleStart = () => {
    if (!isRunning && mode === 'focus') {
      startTimeRef.current = new Date();
    }
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(getDuration(mode));
    startTimeRef.current = null;
  };

  const handleModeChange = (newMode: TimerMode) => {
    setIsRunning(false);
    setMode(newMode);
    startTimeRef.current = null;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = ((getDuration(mode) - timeLeft) / getDuration(mode)) * 100;

  const modeConfig = {
    focus: { label: 'Focus', icon: Brain, color: '#6366f1' },
    shortBreak: { label: 'Short Break', icon: Coffee, color: '#10b981' },
    longBreak: { label: 'Long Break', icon: Zap, color: '#f59e0b' },
  };

  const CurrentIcon = modeConfig[mode].icon;

  return (
    <Card className="max-w-md mx-auto">
      {/* Mode Selector */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {(Object.keys(modeConfig) as TimerMode[]).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition-all',
              mode === m
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {modeConfig[m].label}
          </button>
        ))}
      </div>

      {/* Timer Display */}
      <div className="flex flex-col items-center justify-center mb-8">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative"
        >
          <CircularProgress
            value={progress}
            max={100}
            size={240}
            strokeWidth={12}
            showLabel={false}
            color={modeConfig[mode].color}
          >
            <div className="text-center">
              <CurrentIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <motion.span
                key={timeLeft}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                className="text-5xl font-bold text-foreground font-mono"
              >
                {formatTime(timeLeft)}
              </motion.span>
              <p className="text-sm text-muted-foreground mt-2">{modeConfig[mode].label}</p>
            </div>
          </CircularProgress>

          {/* Animated glow effect when running */}
          {isRunning && (
            <motion.div
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow: `0 0 60px ${modeConfig[mode].color}40`,
              }}
            />
          )}
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button
          onClick={handleReset}
          className="p-3 rounded-xl bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isRunning ? handlePause : handleStart}
          className={cn(
            'w-16 h-16 rounded-2xl flex items-center justify-center',
            'bg-gradient-to-r shadow-lg transition-all',
            isRunning
              ? 'from-orange-500 to-red-600 shadow-orange-500/25'
              : 'from-indigo-500 to-purple-600 shadow-indigo-500/25'
          )}
        >
          {isRunning ? (
            <Pause className="w-6 h-6 text-white" />
          ) : (
            <Play className="w-6 h-6 text-white ml-1" />
          )}
        </motion.button>

        <button
          onClick={() => setShowSettings(true)}
          className="p-3 rounded-xl bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Subject Selector */}
      <div className="mb-4 space-y-2">
        <Label>Studying for</Label>
        <Select value={subjectId || "none"} onValueChange={(value) => setSubjectId(value === "none" ? "" : value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select a subject (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No subject</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sessions Counter */}
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {Array.from({ length: pomodoroSettings.sessionsBeforeLongBreak }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-3 h-3 rounded-full transition-all',
                  i < (sessionsCompleted % pomodoroSettings.sessionsBeforeLongBreak)
                    ? 'bg-indigo-500'
                    : 'bg-muted-foreground/20'
                )}
              />
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {sessionsCompleted} sessions today
          </span>
        </div>

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          {soundEnabled ? (
            <Volume2 className="w-4 h-4" />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Settings Modal */}
      <PomodoroSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </Card>
  );
}

function PomodoroSettings({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { pomodoroSettings, updatePomodoroSettings } = useAppStore();
  
  const [focusDuration, setFocusDuration] = useState(pomodoroSettings.focusDuration.toString());
  const [shortBreakDuration, setShortBreakDuration] = useState(pomodoroSettings.shortBreakDuration.toString());
  const [longBreakDuration, setLongBreakDuration] = useState(pomodoroSettings.longBreakDuration.toString());
  const [sessionsBeforeLongBreak, setSessionsBeforeLongBreak] = useState(pomodoroSettings.sessionsBeforeLongBreak.toString());

  const handleSave = () => {
    updatePomodoroSettings({
      focusDuration: parseInt(focusDuration) || 25,
      shortBreakDuration: parseInt(shortBreakDuration) || 5,
      longBreakDuration: parseInt(longBreakDuration) || 15,
      sessionsBeforeLongBreak: parseInt(sessionsBeforeLongBreak) || 4,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Timer Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="focus">Focus Duration (minutes)</Label>
            <Input
              id="focus"
              type="number"
              min="1"
              max="120"
              value={focusDuration}
              onChange={(e) => setFocusDuration(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="short-break">Short Break (minutes)</Label>
            <Input
              id="short-break"
              type="number"
              min="1"
              max="30"
              value={shortBreakDuration}
              onChange={(e) => setShortBreakDuration(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="long-break">Long Break (minutes)</Label>
            <Input
              id="long-break"
              type="number"
              min="1"
              max="60"
              value={longBreakDuration}
              onChange={(e) => setLongBreakDuration(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sessions">Sessions before Long Break</Label>
            <Input
              id="sessions"
              type="number"
              min="1"
              max="10"
              value={sessionsBeforeLongBreak}
              onChange={(e) => setSessionsBeforeLongBreak(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} className="flex-1">
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
