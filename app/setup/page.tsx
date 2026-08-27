'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/Card';
import {
  ArrowRight,
  ArrowLeft,
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
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { Theme } from '@/lib/store';
import {
  canvasFeedUrlValidationMessage,
  normalizeCanvasFeedUrl,
} from '@/lib/integrations/canvas-feed-url';
import { SETUP_COMPLETED_STORAGE_NAMESPACE } from '@/lib/setup-completion';
import { userScopedStorageKey } from '@/lib/user-scoped-storage';
import * as db from '@/lib/supabase/services';

const SUBJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#2563eb',
];

const STEPS = ['profile', 'subjects', 'integrations', 'preferences', 'complete'] as const;
type Step = typeof STEPS[number];

class CanvasSetupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasSetupValidationError';
  }
}

async function validateCanvasFeedForSetup(rawUrl: string): Promise<string> {
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeCanvasFeedUrl(rawUrl);
  } catch (error) {
    throw new CanvasSetupValidationError(
      error instanceof Error ? error.message : 'Enter a valid Canvas calendar feed URL.',
    );
  }
  let response: Response;
  try {
    response = await fetch('/api/canvas/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icalUrl: normalizedUrl }),
    });
  } catch {
    throw new CanvasSetupValidationError('Orderly could not validate Canvas right now. Check your connection and retry.');
  }

  const payload = await response.json().catch(() => null) as { valid?: boolean; error?: string } | null;
  if (!response.ok || payload?.valid !== true) {
    throw new CanvasSetupValidationError(
      payload?.error || 'Orderly could not read that Canvas feed. Copy a fresh Calendar Feed URL and try again.',
    );
  }

  return normalizedUrl;
}

export default function SetupPage() {
  const router = useRouter();
  const { user, updateUserProfile, addSubject, setTheme, theme, subjects } = useAppStore();
  const [currentStep, setCurrentStep] = useState<Step>('profile');
  const [direction, setDirection] = useState(1);

  // Profile state
  const [displayName, setDisplayName] = useState('');
  const userProfileSource = user ? `${user.id}:${user.full_name || ''}` : '';
  const [displayNameSource, setDisplayNameSource] = useState(userProfileSource);
  if (displayNameSource !== userProfileSource) {
    setDisplayNameSource(userProfileSource);
    setDisplayName(user?.full_name || '');
  }

  // Subjects state
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [addedSubjects, setAddedSubjects] = useState<Array<{ name: string; color: string }>>([]);

  // Integrations state
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasUrlError, setCanvasUrlError] = useState('');

  // Preferences state
  const [selectedTheme, setSelectedTheme] = useState<Theme>(theme);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupError, setSetupError] = useState('');

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

  const handleIntegrationContinue = () => {
    const error = canvasUrl.trim() ? canvasFeedUrlValidationMessage(canvasUrl) : null;
    if (error) {
      setCanvasUrlError(error);
      return;
    }
    setCanvasUrlError('');
    goNext();
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
    if (!user) {
      setSetupError('Your session is no longer available. Sign in again, then retry setup.');
      return;
    }
    setIsSubmitting(true);
    setSetupError('');

    try {
      // Save Canvas first so a retryable connection failure cannot leave
      // duplicated subjects from a partially completed setup attempt.
      if (canvasUrl.trim()) {
        const validatedCanvasUrl = await validateCanvasFeedForSetup(canvasUrl);
        const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const savedCanvasSettings = await db.upsertCanvasSettings(user.id, {
          ical_url: validatedCanvasUrl,
          last_sync_at: null,
          sync_enabled: true,
          // Date-only Canvas assignments are due at 11:59 PM in the user's
          // timezone. Save that zone atomically with the connection so the
          // first background sync cannot hydrate them as UTC.
          time_zone: browserTimeZone,
        });
        if (!savedCanvasSettings) {
          throw new Error('We could not save your Canvas connection. Check the feed URL and try again.');
        }
      }

      // Save profile name if changed
      if (displayName.trim() && displayName.trim() !== user.full_name) {
        const updatedProfile = await updateUserProfile({ full_name: displayName.trim() });
        if (!updatedProfile) {
          throw new Error('We could not save your profile. Please try again.');
        }
      }

      // Save subjects
      const savedSubjectNames = new Set(subjects.map(subject => subject.name.trim().toLowerCase()));
      for (const subject of addedSubjects) {
        const normalizedName = subject.name.trim().toLowerCase();
        if (savedSubjectNames.has(normalizedName)) continue;

        const createdSubject = await addSubject({
          user_id: user.id,
          name: subject.name,
          color: subject.color,
        });
        if (!createdSubject) {
          throw new Error(`We could not save ${subject.name}. Please try again.`);
        }
        savedSubjectNames.add(normalizedName);
      }

      // Save theme
      setTheme(selectedTheme);

      // Supabase Auth metadata is the durable source of truth. The scoped
      // browser marker is only a fast cache and a compatibility bridge for
      // accounts that completed setup in an older release.
      const setupMarked = await db.markSetupComplete(user.id);
      if (!setupMarked) {
        throw new Error('We could not confirm setup completion. Please retry.');
      }
      const setupStorageKey = userScopedStorageKey(SETUP_COMPLETED_STORAGE_NAMESPACE, user.id);
      try {
        if (setupStorageKey) localStorage.setItem(setupStorageKey, 'true');
      } catch {
        // Auth metadata is the durable source of truth. A blocked browser
        // cache must not trap a successfully completed account in setup.
      }

      router.replace('/');
    } catch (error) {
      console.error('Error completing setup:', error);
      if (error instanceof CanvasSetupValidationError) {
        setCanvasUrlError(error.message);
        setDirection(-1);
        setCurrentStep('integrations');
        return;
      }
      setSetupError(error instanceof Error
        ? error.message
        : 'We could not finish setup. Your details are still here, so you can retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0 }),
  };

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
                {/* Step: Profile */}
                {currentStep === 'profile' && (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-4">
                        <User className="w-6 h-6 text-indigo-400" />
                      </div>
                      <h2 className="text-2xl font-bold">What should we call you?</h2>
                      <p className="text-muted-foreground mt-1">
                        This is how your name will appear across Orderly.
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
                        <Label htmlFor="subjectColorCycle">Color</Label>
                        <div className="relative">
                          <button
                            id="subjectColorCycle"
                            type="button"
                            aria-label={`Current subject color ${newSubjectColor}. Select the next color.`}
                            className="w-10 h-10 rounded-lg border border-border shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                        aria-label="Add subject"
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
                          aria-label={`Use subject color ${color}`}
                          aria-pressed={newSubjectColor === color}
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
                              aria-label={`Remove ${subject.name}`}
                              className="text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                        Import assignments automatically from Canvas. You can always set this up later in Settings &rarr; Integrations.
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
                          onChange={(e) => {
                            setCanvasUrl(e.target.value);
                            if (canvasUrlError) setCanvasUrlError('');
                          }}
                          onBlur={() => {
                            if (canvasUrl.trim()) {
                              setCanvasUrlError(canvasFeedUrlValidationMessage(canvasUrl) || '');
                            }
                          }}
                          aria-invalid={Boolean(canvasUrlError)}
                          aria-describedby={canvasUrlError ? 'canvasUrlHelp canvasUrlError' : 'canvasUrlHelp'}
                        />
                        <p id="canvasUrlHelp" className="text-xs text-muted-foreground">
                          Find this in Canvas &rarr; Calendar &rarr; Calendar Feed (link at the bottom)
                        </p>
                        {canvasUrlError && (
                          <p id="canvasUrlError" role="alert" className="text-xs text-red-400">
                            {canvasUrlError}
                          </p>
                        )}
                      </div>
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
                          aria-pressed={selectedTheme === option.value}
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
                      <h2 className="text-3xl font-bold mb-2">Ready to finish?</h2>
                      <p className="text-muted-foreground text-lg">
                        Welcome aboard{displayName ? `, ${displayName}` : ''}. Time to ace your studies.
                      </p>
                    </div>

                    <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                      {addedSubjects.length > 0 && (
                        <p>{addedSubjects.length} subject{addedSubjects.length !== 1 ? 's' : ''} ready to go</p>
                      )}
                      {canvasUrl.trim() && (
                        <p>Canvas integration ready to connect</p>
                      )}
                      <p>Theme: {selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1)}</p>
                    </div>

                    {setupError && (
                      <div
                        role="alert"
                        aria-live="assertive"
                        className="mx-auto flex max-w-lg items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-left text-sm text-red-300"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{setupError} Your setup details are still here.</span>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border/50">
              <div>
                {stepIndex > 0 && (
                  <Button variant="ghost" onClick={goBack}>
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                )}
              </div>
              <div>
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
                    onClick={handleIntegrationContinue}
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
                        {setupError ? 'Retry setup' : 'Go to Dashboard'}
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
