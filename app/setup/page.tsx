'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/Card';
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckSquare,
  Timer,
  BarChart3,
  Users,
  GraduationCap,
  User,
  BookOpen,
  Plus,
  X,
  Sun,
  Moon,
  Monitor,
  Check,
  Rocket,
  Link2,
  ExternalLink,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { Theme } from '@/lib/store';
import * as db from '@/lib/supabase/services';

const SUBJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#2563eb',
];

const STEPS = ['welcome', 'profile', 'subjects', 'integrations', 'preferences', 'complete'] as const;
type Step = typeof STEPS[number];

export default function SetupPage() {
  const router = useRouter();
  const { user, updateUserProfile, addSubject, setTheme, theme, subjects } = useAppStore();
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [direction, setDirection] = useState(1);

  // Profile state
  const [displayName, setDisplayName] = useState('');

  // Subjects state
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [addedSubjects, setAddedSubjects] = useState<Array<{ name: string; color: string }>>([]);

  // Integrations state
  const [canvasUrl, setCanvasUrl] = useState('');

  // Preferences state
  const [selectedTheme, setSelectedTheme] = useState<Theme>(theme);

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user?.full_name) {
      setDisplayName(user.full_name);
    }
  }, [user]);

  const stepIndex = STEPS.indexOf(currentStep);
  const progress = ((stepIndex) / (STEPS.length - 1)) * 100;

  const goNext = () => {
    setDirection(1);
    const next = STEPS[stepIndex + 1];
    if (next) setCurrentStep(next);
  };

  const goBack = () => {
    setDirection(-1);
    const prev = STEPS[stepIndex - 1];
    if (prev) setCurrentStep(prev);
  };

  const handleAddSubject = () => {
    const trimmed = newSubjectName.trim();
    if (!trimmed) return;
    if (addedSubjects.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) return;
    setAddedSubjects(prev => [...prev, { name: trimmed, color: newSubjectColor }]);
    setNewSubjectName('');
    // Cycle to next color
    const currentIndex = SUBJECT_COLORS.indexOf(newSubjectColor);
    setNewSubjectColor(SUBJECT_COLORS[(currentIndex + 1) % SUBJECT_COLORS.length]);
  };

  const handleRemoveSubject = (name: string) => {
    setAddedSubjects(prev => prev.filter(s => s.name !== name));
  };

  const handleFinish = async () => {
    if (!user) return;
    setIsSubmitting(true);

    try {
      // Save profile name if changed
      if (displayName.trim() && displayName.trim() !== user.full_name) {
        await updateUserProfile({ full_name: displayName.trim() });
      }

      // Save subjects
      for (const subject of addedSubjects) {
        await addSubject({ user_id: user.id, name: subject.name, color: subject.color });
      }

      // Save Canvas integration if URL provided
      if (canvasUrl.trim()) {
        try {
          await db.upsertCanvasSettings(user.id, {
            ical_url: canvasUrl.trim(),
            last_sync_at: null,
            sync_enabled: true,
          });
        } catch (err) {
          console.error('Error saving Canvas settings:', err);
        }
      }

      // Save theme
      setTheme(selectedTheme);

      // Mark setup as complete
      localStorage.setItem('orderly-setup-complete', 'true');

      router.push('/');
    } catch (error) {
      console.error('Error completing setup:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0 }),
  };

  const features = [
    { icon: CheckSquare, label: 'Smart Tasks', desc: 'Manage assignments with priorities & due dates' },
    { icon: Timer, label: 'Pomodoro Timer', desc: 'Focus sessions with gamified progress' },
    { icon: BarChart3, label: 'Analytics', desc: 'Track your study habits over time' },
    { icon: Users, label: 'Social', desc: 'Study with friends & compete on leaderboards' },
    { icon: GraduationCap, label: 'Exam Prep', desc: 'Track preparation for upcoming exams' },
    { icon: BookOpen, label: 'LMS Sync', desc: 'Import from Canvas & Google Classroom' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-indigo-500/10">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-2xl relative">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              Step {stepIndex + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
            />
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden">
          <CardContent className="p-8">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                {/* Step: Welcome */}
                {currentStep === 'welcome' && (
                  <div className="text-center space-y-8">
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-bold mb-2">Welcome to Orderly!</h1>
                      <p className="text-muted-foreground text-lg">
                        Let&apos;s get you set up in just a few steps.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-left">
                      {features.map((feature, i) => (
                        <motion.div
                          key={feature.label}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 + i * 0.08 }}
                          className="p-4 rounded-xl border border-border/50 bg-muted/30 space-y-2"
                        >
                          <feature.icon className="w-5 h-5 text-indigo-400" />
                          <p className="font-medium text-sm">{feature.label}</p>
                          <p className="text-xs text-muted-foreground">{feature.desc}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step: Profile */}
                {currentStep === 'profile' && (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-4">
                        <User className="w-6 h-6 text-indigo-400" />
                      </div>
                      <h2 className="text-2xl font-bold">What should we call you?</h2>
                      <p className="text-muted-foreground mt-1">
                        This is how you&apos;ll appear to friends and on leaderboards.
                      </p>
                    </div>

                    <div className="max-w-sm mx-auto space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="displayName">Display Name</Label>
                        <Input
                          id="displayName"
                          type="text"
                          placeholder="e.g. Alex Chen"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          autoFocus
                        />
                      </div>
                      {user?.email && (
                        <p className="text-sm text-muted-foreground">
                          Signed in as {user.email}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Step: Subjects */}
                {currentStep === 'subjects' && (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
                        <BookOpen className="w-6 h-6 text-purple-400" />
                      </div>
                      <h2 className="text-2xl font-bold">Add your classes</h2>
                      <p className="text-muted-foreground mt-1">
                        Subjects help organize your tasks, study sessions, and exams. You can always add more later.
                      </p>
                    </div>

                    {/* Add subject input */}
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="subjectName">Subject name</Label>
                        <Input
                          id="subjectName"
                          type="text"
                          placeholder="e.g. Calculus, Biology 101"
                          value={newSubjectName}
                          onChange={(e) => setNewSubjectName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddSubject();
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Color</Label>
                        <div className="relative">
                          <button
                            type="button"
                            className="w-10 h-10 rounded-lg border border-border shadow-sm"
                            style={{ backgroundColor: newSubjectColor }}
                            onClick={() => {
                              const currentIndex = SUBJECT_COLORS.indexOf(newSubjectColor);
                              setNewSubjectColor(SUBJECT_COLORS[(currentIndex + 1) % SUBJECT_COLORS.length]);
                            }}
                          />
                        </div>
                      </div>
                      <Button
                        onClick={handleAddSubject}
                        disabled={!newSubjectName.trim()}
                        size="icon"
                        className="h-10 w-10 shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Color palette */}
                    <div className="flex flex-wrap gap-2">
                      {SUBJECT_COLORS.map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewSubjectColor(color)}
                          className={`w-6 h-6 rounded-full transition-all ${
                            newSubjectColor === color ? 'ring-2 ring-offset-2 ring-offset-background ring-indigo-500 scale-110' : 'hover:scale-110'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>

                    {/* Added subjects */}
                    <div className="space-y-2 min-h-[120px]">
                      <AnimatePresence>
                        {addedSubjects.map(subject => (
                          <motion.div
                            key={subject.name}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/30"
                          >
                            <div
                              className="w-4 h-4 rounded-full shrink-0"
                              style={{ backgroundColor: subject.color }}
                            />
                            <span className="flex-1 font-medium text-sm">{subject.name}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveSubject(subject.name)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {addedSubjects.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No subjects added yet. Add your classes above, or skip this step.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Step: Integrations */}
                {currentStep === 'integrations' && (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-4">
                        <Link2 className="w-6 h-6 text-orange-400" />
                      </div>
                      <h2 className="text-2xl font-bold">Connect your LMS</h2>
                      <p className="text-muted-foreground mt-1">
                        Import assignments automatically from Canvas or Google Classroom. You can always set this up later in Settings &rarr; Integrations.
                      </p>
                    </div>

                    {/* Canvas */}
                    <div className="p-4 rounded-xl border border-border/50 bg-muted/30 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-orange-500/10">
                          <svg className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18L18.82 8 12 11.82 5.18 8 12 4.18zM5 9.5l6.5 3.61v7.71L5 17.21V9.5zm8.5 11.32v-7.71L20 9.5v7.71l-6.5 3.61z" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium text-sm">Canvas LMS</p>
                          <p className="text-xs text-muted-foreground">Paste your Canvas calendar iCal URL to auto-import assignments</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="canvasUrl">Canvas iCal Feed URL</Label>
                        <Input
                          id="canvasUrl"
                          type="url"
                          placeholder="https://canvas.instructure.com/feeds/calendars/user_xxx.ics"
                          value={canvasUrl}
                          onChange={(e) => setCanvasUrl(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Find this in Canvas &rarr; Calendar &rarr; Calendar Feed (link at the bottom)
                        </p>
                      </div>
                    </div>

                    {/* Google Classroom */}
                    <div className="p-4 rounded-xl border border-border/50 bg-muted/30 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                          <GraduationCap className="w-5 h-5 text-blue-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Google Classroom</p>
                          <p className="text-xs text-muted-foreground">Connect your Google account to sync courses and assignments</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Connect Google Classroom in Settings &rarr; Integrations after setup to import your courses and assignments automatically.
                      </p>
                    </div>

                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">
                        Integrations automatically create classes, import assignments as tasks, and keep everything in sync.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step: Preferences */}
                {currentStep === 'preferences' && (
                  <div className="space-y-8">
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-4">
                        <Sun className="w-6 h-6 text-green-400" />
                      </div>
                      <h2 className="text-2xl font-bold">Pick your look</h2>
                      <p className="text-muted-foreground mt-1">
                        Choose a theme. You can change this anytime in settings.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
                      {([
                        { value: 'light' as Theme, icon: Sun, label: 'Light' },
                        { value: 'dark' as Theme, icon: Moon, label: 'Dark' },
                        { value: 'system' as Theme, icon: Monitor, label: 'System' },
                      ]).map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setSelectedTheme(option.value)}
                          className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                            selectedTheme === option.value
                              ? 'border-indigo-500 bg-indigo-500/10'
                              : 'border-border hover:border-indigo-500/50'
                          }`}
                        >
                          <option.icon className={`w-6 h-6 ${selectedTheme === option.value ? 'text-indigo-400' : 'text-muted-foreground'}`} />
                          <span className={`text-sm font-medium ${selectedTheme === option.value ? 'text-indigo-400' : ''}`}>
                            {option.label}
                          </span>
                          {selectedTheme === option.value && (
                            <motion.div
                              layoutId="themeCheck"
                              className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center"
                            >
                              <Check className="w-3 h-3 text-white" />
                            </motion.div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step: Complete */}
                {currentStep === 'complete' && (
                  <div className="text-center space-y-6">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
                      className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center"
                    >
                      <Rocket className="w-10 h-10 text-white" />
                    </motion.div>
                    <div>
                      <h2 className="text-3xl font-bold mb-2">You&apos;re all set!</h2>
                      <p className="text-muted-foreground text-lg">
                        Welcome aboard{displayName ? `, ${displayName}` : ''}. Time to ace your studies.
                      </p>
                    </div>

                    <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                      {addedSubjects.length > 0 && (
                        <p>{addedSubjects.length} subject{addedSubjects.length !== 1 ? 's' : ''} ready to go</p>
                      )}
                      {canvasUrl.trim() && (
                        <p>Canvas integration connected</p>
                      )}
                      <p>Theme: {selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1)}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border/50">
              <div>
                {stepIndex > 0 && currentStep !== 'complete' && (
                  <Button variant="ghost" onClick={goBack}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                )}
              </div>
              <div>
                {currentStep === 'welcome' && (
                  <Button
                    onClick={goNext}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                  >
                    Get Started
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                {currentStep === 'profile' && (
                  <Button
                    onClick={goNext}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                    disabled={!displayName.trim()}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                {currentStep === 'subjects' && (
                  <Button
                    onClick={goNext}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                  >
                    {addedSubjects.length === 0 ? 'Skip' : 'Continue'}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                {currentStep === 'integrations' && (
                  <Button
                    onClick={goNext}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                  >
                    {canvasUrl.trim() ? 'Continue' : 'Skip'}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                {currentStep === 'preferences' && (
                  <Button
                    onClick={goNext}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                  >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                {currentStep === 'complete' && (
                  <Button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        Go to Dashboard
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
