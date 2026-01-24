'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { CircularProgress } from '@/components/ui/custom-progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
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
  Timer,
  Clock,
  Save,
  Trash2,
} from 'lucide-react';

type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
type TimerType = 'pomodoro' | 'stopwatch';

interface TimerPreset {
  id: string;
  name: string;
  focusHours: number;
  focusMinutes: number;
  focusSeconds: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
}

interface PomodoroTimerProps {
  selectedSubjectId?: string | null;
  selectedTaskId?: string | null;
}

// Notification sound using Web Audio API
const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
    
    // Play a second beep
    setTimeout(() => {
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.value = 1000;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      osc2.start(audioContext.currentTime);
      osc2.stop(audioContext.currentTime + 0.5);
    }, 300);
    
    // Play a third beep
    setTimeout(() => {
      const osc3 = audioContext.createOscillator();
      const gain3 = audioContext.createGain();
      osc3.connect(gain3);
      gain3.connect(audioContext.destination);
      osc3.frequency.value = 1200;
      osc3.type = 'sine';
      gain3.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain3.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
      osc3.start(audioContext.currentTime);
      osc3.stop(audioContext.currentTime + 0.8);
    }, 600);
  } catch (e) {
    console.log('Audio not supported');
  }
};

export function PomodoroTimer({ selectedSubjectId, selectedTaskId }: PomodoroTimerProps) {
  const { pomodoroSettings, updatePomodoroSettings, addStudySession, subjects, user } = useAppStore();
  
  const [timerType, setTimerType] = useState<TimerType>('pomodoro');
  const [mode, setMode] = useState<TimerMode>('focus');
  const [timeLeft, setTimeLeft] = useState(pomodoroSettings.focusDuration * 60);
  const [stopwatchTime, setStopwatchTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionsCompleted, setSessions] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [subjectId, setSubjectId] = useState(selectedSubjectId || '');
  
  // Presets
  const [presets, setPresets] = useState<TimerPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  
  const startTimeRef = useRef<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load presets from localStorage
  useEffect(() => {
    const savedPresets = localStorage.getItem('timerPresets');
    if (savedPresets) {
      setPresets(JSON.parse(savedPresets));
    }
  }, []);

  // Save presets to localStorage
  useEffect(() => {
    localStorage.setItem('timerPresets', JSON.stringify(presets));
  }, [presets]);

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
    if (timerType === 'pomodoro') {
      setTimeLeft(getDuration(mode));
    }
  }, [mode, getDuration, timerType]);

  // Timer logic
  useEffect(() => {
    if (isRunning) {
      if (timerType === 'pomodoro' && timeLeft > 0) {
        intervalRef.current = setInterval(() => {
          setTimeLeft((prev) => prev - 1);
        }, 1000);
      } else if (timerType === 'stopwatch') {
        intervalRef.current = setInterval(() => {
          setStopwatchTime((prev) => prev + 1);
        }, 1000);
      } else if (timerType === 'pomodoro' && timeLeft === 0) {
        handleTimerComplete();
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timeLeft, timerType]);

  const handleTimerComplete = async () => {
    setIsRunning(false);
    
    // Play notification sound
    if (soundEnabled) {
      playNotificationSound();
    }

    if (mode === 'focus') {
      // Save study session
      const duration = pomodoroSettings.focusDuration;
      await addStudySession({
        user_id: user?.id || '',
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

      if (newSessions % pomodoroSettings.sessionsBeforeLongBreak === 0) {
        setMode('longBreak');
      } else {
        setMode('shortBreak');
      }
    } else {
      setMode('focus');
    }

    startTimeRef.current = null;
  };

  const handleStart = () => {
    if (!isRunning && (timerType === 'pomodoro' ? mode === 'focus' : true)) {
      startTimeRef.current = new Date();
    }
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    if (timerType === 'pomodoro') {
      setTimeLeft(getDuration(mode));
    } else {
      setStopwatchTime(0);
    }
    startTimeRef.current = null;
  };

  const handleStopwatchSave = async () => {
    if (stopwatchTime < 60) return; // Minimum 1 minute
    
    await addStudySession({
      user_id: user?.id || '',
      subject_id: subjectId || null,
      task_id: selectedTaskId || null,
      duration_minutes: Math.floor(stopwatchTime / 60),
      session_type: 'free_study',
      started_at: startTimeRef.current?.toISOString() || new Date().toISOString(),
      ended_at: new Date().toISOString(),
      notes: null,
    });

    if (soundEnabled) {
      playNotificationSound();
    }
    
    handleReset();
  };

  const handleModeChange = (newMode: TimerMode) => {
    setIsRunning(false);
    setMode(newMode);
    startTimeRef.current = null;
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = timerType === 'pomodoro' 
    ? ((getDuration(mode) - timeLeft) / getDuration(mode)) * 100
    : 0;

  const modeConfig = {
    focus: { label: 'Focus', icon: Brain, color: '#6366f1' },
    shortBreak: { label: 'Short Break', icon: Coffee, color: '#10b981' },
    longBreak: { label: 'Long Break', icon: Zap, color: '#f59e0b' },
  };

  const CurrentIcon = modeConfig[mode].icon;

  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="p-4">
        {/* Timer Type Toggle */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            onClick={() => { setTimerType('pomodoro'); handleReset(); }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              timerType === 'pomodoro'
                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Timer className="w-4 h-4" />
            Pomodoro
          </button>
          <button
            onClick={() => { setTimerType('stopwatch'); handleReset(); }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              timerType === 'stopwatch'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <Clock className="w-4 h-4" />
            Stopwatch
          </button>
        </div>

        {/* Mode Selector (Pomodoro only) */}
        {timerType === 'pomodoro' && (
          <div className="flex items-center justify-center gap-1 mb-6">
            {(Object.keys(modeConfig) as TimerMode[]).map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  mode === m
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {modeConfig[m].label}
              </button>
            ))}
          </div>
        )}

        {/* Timer Display */}
        <div className="flex flex-col items-center justify-center mb-6">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative">
            <CircularProgress
              value={timerType === 'pomodoro' ? progress : (stopwatchTime % 3600) / 36}
              max={100}
              size={200}
              strokeWidth={10}
              showLabel={false}
              color={timerType === 'pomodoro' ? modeConfig[mode].color : '#10b981'}
            >
              <div className="text-center">
                {timerType === 'pomodoro' && <CurrentIcon className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />}
                {timerType === 'stopwatch' && <Clock className="w-6 h-6 mx-auto mb-1 text-green-400" />}
                <motion.span
                  key={timerType === 'pomodoro' ? timeLeft : stopwatchTime}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  className="text-4xl font-bold text-foreground font-mono"
                >
                  {timerType === 'pomodoro' ? formatTime(timeLeft) : formatTime(stopwatchTime)}
                </motion.span>
                <p className="text-xs text-muted-foreground mt-1">
                  {timerType === 'pomodoro' ? modeConfig[mode].label : 'Stopwatch'}
                </p>
              </div>
            </CircularProgress>

            {isRunning && (
              <motion.div
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `0 0 40px ${timerType === 'pomodoro' ? modeConfig[mode].color : '#10b981'}40` }}
              />
            )}
          </motion.div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <button onClick={handleReset} className="p-2.5 rounded-xl bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <RotateCcw className="w-4 h-4" />
          </button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={isRunning ? handlePause : handleStart}
            className={cn(
              'w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all',
              isRunning
                ? 'bg-gradient-to-r from-orange-500 to-red-600 shadow-orange-500/25'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 shadow-indigo-500/25'
            )}
          >
            {isRunning ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white ml-0.5" />}
          </motion.button>

          <button onClick={() => setShowSettings(true)} className="p-2.5 rounded-xl bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Save button for stopwatch */}
        {timerType === 'stopwatch' && stopwatchTime >= 60 && (
          <Button onClick={handleStopwatchSave} className="w-full mb-4" size="sm">
            <Save className="w-4 h-4 mr-2" />
            Save Session ({Math.floor(stopwatchTime / 60)} min)
          </Button>
        )}

        {/* Subject Selector */}
        <div className="mb-3 space-y-1">
          <Label className="text-xs">Studying for</Label>
          <Select value={subjectId || "none"} onValueChange={(value) => setSubjectId(value === "none" ? "" : value)}>
            <SelectTrigger className="h-8 text-sm">
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
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              {Array.from({ length: pomodoroSettings.sessionsBeforeLongBreak }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-2.5 h-2.5 rounded-full transition-all',
                    i < (sessionsCompleted % pomodoroSettings.sessionsBeforeLongBreak) ? 'bg-indigo-500' : 'bg-muted-foreground/20'
                  )}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{sessionsCompleted} sessions</span>
          </div>

          <button onClick={() => setSoundEnabled(!soundEnabled)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </CardContent>

      {/* Settings Modal */}
      <PomodoroSettings isOpen={showSettings} onClose={() => setShowSettings(false)} presets={presets} setPresets={setPresets} />
    </Card>
  );
}

function PomodoroSettings({ isOpen, onClose, presets, setPresets }: { 
  isOpen: boolean; 
  onClose: () => void;
  presets: TimerPreset[];
  setPresets: (presets: TimerPreset[]) => void;
}) {
  const { pomodoroSettings, updatePomodoroSettings } = useAppStore();
  
  // Split duration into hours, minutes, seconds
  const totalFocusSeconds = pomodoroSettings.focusDuration * 60;
  const [focusHours, setFocusHours] = useState(Math.floor(totalFocusSeconds / 3600).toString());
  const [focusMinutes, setFocusMinutes] = useState(Math.floor((totalFocusSeconds % 3600) / 60).toString());
  const [focusSeconds, setFocusSeconds] = useState((totalFocusSeconds % 60).toString());
  
  const [shortBreakMinutes, setShortBreakMinutes] = useState(pomodoroSettings.shortBreakDuration.toString());
  const [longBreakMinutes, setLongBreakMinutes] = useState(pomodoroSettings.longBreakDuration.toString());
  const [sessionsBeforeLongBreak, setSessionsBeforeLongBreak] = useState(pomodoroSettings.sessionsBeforeLongBreak.toString());
  
  const [newPresetName, setNewPresetName] = useState('');

  const handleSave = () => {
    const totalMinutes = (parseInt(focusHours) || 0) * 60 + (parseInt(focusMinutes) || 0) + Math.ceil((parseInt(focusSeconds) || 0) / 60);
    updatePomodoroSettings({
      focusDuration: Math.max(1, totalMinutes),
      shortBreakDuration: parseInt(shortBreakMinutes) || 5,
      longBreakDuration: parseInt(longBreakMinutes) || 15,
      sessionsBeforeLongBreak: parseInt(sessionsBeforeLongBreak) || 4,
    });
    onClose();
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    
    const newPreset: TimerPreset = {
      id: crypto.randomUUID(),
      name: newPresetName,
      focusHours: parseInt(focusHours) || 0,
      focusMinutes: parseInt(focusMinutes) || 25,
      focusSeconds: parseInt(focusSeconds) || 0,
      shortBreakMinutes: parseInt(shortBreakMinutes) || 5,
      longBreakMinutes: parseInt(longBreakMinutes) || 15,
      sessionsBeforeLongBreak: parseInt(sessionsBeforeLongBreak) || 4,
    };
    
    setPresets([...presets, newPreset]);
    setNewPresetName('');
  };

  const handleLoadPreset = (preset: TimerPreset) => {
    setFocusHours(preset.focusHours.toString());
    setFocusMinutes(preset.focusMinutes.toString());
    setFocusSeconds(preset.focusSeconds.toString());
    setShortBreakMinutes(preset.shortBreakMinutes.toString());
    setLongBreakMinutes(preset.longBreakMinutes.toString());
    setSessionsBeforeLongBreak(preset.sessionsBeforeLongBreak.toString());
  };

  const handleDeletePreset = (id: string) => {
    setPresets(presets.filter(p => p.id !== id));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Timer Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto">
          {/* Focus Duration with H:M:S */}
          <div className="space-y-2">
            <Label className="text-sm">Focus Duration</Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Hours</Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={focusHours}
                  onChange={(e) => setFocusHours(e.target.value)}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Minutes</Label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={focusMinutes}
                  onChange={(e) => setFocusMinutes(e.target.value)}
                  className="h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Seconds</Label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={focusSeconds}
                  onChange={(e) => setFocusSeconds(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Short Break (min)</Label>
              <Input type="number" min="1" max="30" value={shortBreakMinutes} onChange={(e) => setShortBreakMinutes(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Long Break (min)</Label>
              <Input type="number" min="1" max="60" value={longBreakMinutes} onChange={(e) => setLongBreakMinutes(e.target.value)} className="h-8" />
            </div>
          </div>
          
          <div className="space-y-1">
            <Label className="text-sm">Sessions before Long Break</Label>
            <Input type="number" min="1" max="10" value={sessionsBeforeLongBreak} onChange={(e) => setSessionsBeforeLongBreak(e.target.value)} className="h-8" />
          </div>

          {/* Presets */}
          <div className="border-t pt-3">
            <Label className="text-sm font-medium">Presets</Label>
            
            {presets.length > 0 && (
              <div className="space-y-1 mt-2">
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                    <button onClick={() => handleLoadPreset(preset)} className="text-sm font-medium hover:text-primary">
                      {preset.name}
                    </button>
                    <button onClick={() => handleDeletePreset(preset.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-2 mt-2">
              <Input
                placeholder="Preset name..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="h-8 flex-1"
              />
              <Button onClick={handleSavePreset} size="sm" variant="outline" disabled={!newPresetName.trim()} className="h-8">
                <Save className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1 h-8">Cancel</Button>
            <Button onClick={handleSave} className="flex-1 h-8">Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
