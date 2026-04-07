'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  X, ChevronRight, ChevronLeft, CheckCircle2,
  LayoutDashboard, CheckSquare, Calendar, Target,
  Timer, BarChart3, GraduationCap, Crown, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  page?: string;
  tip?: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Orderly! 👋',
    description: 'Your all-in-one academic success platform. Let\'s take a quick tour of everything Orderly has to offer.',
    icon: Sparkles,
    color: 'indigo',
    tip: 'This tour takes about 2 minutes',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Your home base. See upcoming tasks, exam countdowns, study stats, and a mini calendar — all at a glance.',
    icon: LayoutDashboard,
    color: 'blue',
    page: '/',
    tip: 'Check your dashboard every morning to plan your day',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Manage all your assignments and to-dos. Add tasks with due dates, priorities, and subjects. Tasks can be imported from Canvas or Google Classroom.',
    icon: CheckSquare,
    color: 'green',
    page: '/tasks',
    tip: 'Use high priority for assignments due within 2 days',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'See all your tasks and exams displayed directly on the calendar (Google Calendar style). Switch between month, week, and day views.',
    icon: Calendar,
    color: 'purple',
    page: '/calendar',
    tip: 'Tasks show directly on dates — no clicking required!',
  },
  {
    id: 'goals',
    title: 'Goals',
    description: 'Set and track academic goals. Use Auto-Track to sync with completed tasks automatically. The Resume tab helps you track skills and experience.',
    icon: Target,
    color: 'amber',
    page: '/goals',
    tip: 'Goals with unit "tasks" can be auto-tracked from your task completions',
  },
  {
    id: 'study',
    title: 'Study Sessions',
    description: 'Use the Pomodoro timer or stopwatch to track your study time. The AI Scheduler creates a personalized 7-day study plan based on your workload.',
    icon: Timer,
    color: 'rose',
    page: '/study',
    tip: 'The timer pauses when you navigate away — resume it anytime',
  },
  {
    id: 'exams',
    title: 'Exams & Exam Prep',
    description: 'Track upcoming exams and prepare with flashcards, MCQ quizzes, file uploads, and SAT/ACT prep tools. Create study sets linked to specific exams.',
    icon: GraduationCap,
    color: 'violet',
    page: '/exams',
    tip: 'Switch to "Exam Prep" tab to create flashcard sets and MCQ quizzes',
  },
  {
    id: 'analytics',
    title: 'Analytics',
    description: 'Deep insights into your study habits, task completion rates, subject breakdown, and productivity trends over time.',
    icon: BarChart3,
    color: 'cyan',
    page: '/analytics',
    tip: 'Check your weekly report every Sunday',
  },
  {
    id: 'pro',
    title: 'Upgrade to Pro 🚀',
    description: 'Unlock unlimited goals, AI Scheduler, advanced exam prep, desktop notifications, and much more with Orderly Pro.',
    icon: Crown,
    color: 'amber',
    page: '/paywall',
    tip: 'Get 40% off with the yearly plan',
  },
];

const colorMap: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400', icon: 'bg-indigo-500/20' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', icon: 'bg-blue-500/20' },
  green: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', icon: 'bg-green-500/20' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', icon: 'bg-purple-500/20' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', icon: 'bg-amber-500/20' },
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', icon: 'bg-rose-500/20' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400', icon: 'bg-violet-500/20' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', icon: 'bg-cyan-500/20' },
};

interface TutorialProps {
  onComplete?: () => void;
  forceShow?: boolean;
}

export function Tutorial({ onComplete, forceShow = false }: TutorialProps) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('orderly-tutorial-done');
    if (forceShow || !dismissed) {
      // Small delay so page renders first
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, [forceShow]);

  const handleClose = () => {
    localStorage.setItem('orderly-tutorial-done', 'true');
    setVisible(false);
    onComplete?.();
  };

  const handleComplete = () => {
    setCompleted(true);
    setTimeout(() => {
      handleClose();
    }, 1500);
  };

  const currentStep = TUTORIAL_STEPS[step];
  const cfg = colorMap[currentStep.color] || colorMap.indigo;
  const Icon = currentStep.icon;
  const isLast = step === TUTORIAL_STEPS.length - 1;

  if (!visible) return null;

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-md">
              {completed ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-card border border-border rounded-3xl p-8 text-center shadow-2xl"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: 'spring', stiffness: 300 }}
                    className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center"
                  >
                    <CheckCircle2 className="w-10 h-10 text-green-400" />
                  </motion.div>
                  <h3 className="text-2xl font-bold">You're all set! 🎉</h3>
                  <p className="text-muted-foreground mt-2">Let's start your academic journey with Orderly!</p>
                </motion.div>
              ) : (
                <div className={cn('bg-card border rounded-3xl shadow-2xl overflow-hidden', cfg.border)}>
                  {/* Progress bar */}
                  <div className="h-1 bg-muted">
                    <motion.div
                      initial={false}
                      animate={{ width: `${((step + 1) / TUTORIAL_STEPS.length) * 100}%` }}
                      transition={{ duration: 0.3 }}
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                    />
                  </div>

                  <div className="p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-5">
                      <div className={cn('p-3 rounded-2xl', cfg.icon)}>
                        <Icon className={cn('w-7 h-7', cfg.text)} />
                      </div>
                      <button
                        onClick={handleClose}
                        className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-3"
                      >
                        <h3 className="text-xl font-bold">{currentStep.title}</h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">{currentStep.description}</p>

                        {currentStep.tip && (
                          <div className={cn('flex items-start gap-2 p-3 rounded-xl border text-sm', cfg.bg, cfg.border)}>
                            <Sparkles className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cfg.text)} />
                            <p className={cfg.text}>{currentStep.tip}</p>
                          </div>
                        )}
                      </motion.div>
                    </AnimatePresence>

                    {/* Step indicators */}
                    <div className="flex items-center justify-center gap-1.5 mt-5">
                      {TUTORIAL_STEPS.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setStep(i)}
                          className={cn(
                            'rounded-full transition-all',
                            i === step ? 'w-6 h-2 bg-primary' : 'w-2 h-2 bg-muted hover:bg-muted-foreground'
                          )}
                        />
                      ))}
                    </div>

                    {/* Navigation */}
                    <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStep(s => s - 1)}
                        disabled={step === 0}
                        className="gap-1"
                      >
                        <ChevronLeft className="w-4 h-4" /> Back
                      </Button>

                      <span className="text-xs text-muted-foreground">
                        {step + 1} of {TUTORIAL_STEPS.length}
                      </span>

                      {isLast ? (
                        <Button size="sm" onClick={handleComplete} className="gap-1">
                          <CheckCircle2 className="w-4 h-4" /> Done!
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => setStep(s => s + 1)} className="gap-1">
                          Next <ChevronRight className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
