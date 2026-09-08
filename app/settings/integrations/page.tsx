'use client';

import { useState, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { useCanvasSyncSupabase, formatTimeUntilSync, formatLastSync } from '@/lib/integrations/useCanvasSyncSupabase';
import { useAppStore } from '@/lib/store';
import { useCurrentTime } from '@/lib/use-current-time';
import CanvasGuide from '@/components/tutorial/CanvasGuide';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Link2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  ZapOff,
  Timer,
  Trash2,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';

function CanvasIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <path d="M19 4.8A28.7 28.7 0 0 1 32 1.7c4.6 0 9 .9 13 2.8l-3 11.3a18 18 0 0 1-20 0L19 4.8Z" />
      <path d="M59.2 19A28.7 28.7 0 0 1 62.3 32c0 4.6-.9 9-2.8 13l-11.3-3a18 18 0 0 1 0-20L59.2 19Z" />
      <path d="M45 59.2A28.7 28.7 0 0 1 32 62.3c-4.6 0-9-.9-13-2.8l3-11.3a18 18 0 0 1 20 0L45 59.2Z" />
      <path d="M4.8 45A28.7 28.7 0 0 1 1.7 32c0-4.6.9-9 2.8-13l11.3 3a18 18 0 0 1 0 20L4.8 45Z" />
      <circle cx="21" cy="21" r="4.6" />
      <circle cx="43" cy="21" r="4.6" />
      <circle cx="43" cy="43" r="4.6" />
      <circle cx="21" cy="43" r="4.6" />
      <circle cx="32" cy="32" r="4.6" />
    </svg>
  );
}

export default function IntegrationsPage() {
  const { user, tasks, exams, refreshData } = useAppStore();
  const currentTime = useCurrentTime();

  // Canvas live sync hook with Supabase
  const {
    isLoading: isCanvasLoading,
    isSyncing: isCanvasSyncing,
    error: canvasError,
    lastSyncAt,
    nextSyncAt,
    settings: canvasSettings,
    syncNow,
    setIcalUrl,
    toggleAutoSync,
    setSyncInterval,
    clearData,
  } = useCanvasSyncSupabase({
    userId: user?.id || null,
    defaultInterval: 15, // 15 minutes
  });

  // Live countdown display
  const [countdown, setCountdown] = useState('Calculating next sync…');
  const [lastSyncDisplay, setLastSyncDisplay] = useState('Checking last sync…');

  // Update countdown every second
  useEffect(() => {
    const updateDisplays = () => {
      setCountdown(formatTimeUntilSync(nextSyncAt));
      setLastSyncDisplay(formatLastSync(lastSyncAt));
    };

    updateDisplays();
    const interval = setInterval(updateDisplays, 1000);
    return () => clearInterval(interval);
  }, [nextSyncAt, lastSyncAt]);

  // Both sync modes write directly to the persisted tasks/exams tables. Wait
  // until a manual request has left its syncing state, then refresh the wider
  // app without making the Canvas button wait for that unrelated data load.
  const lastSyncTimestamp = lastSyncAt?.getTime() ?? 0;
  const refreshedSyncTimestampRef = useRef(0);
  useEffect(() => {
    if (lastSyncTimestamp <= 0 || isCanvasSyncing) return;
    if (refreshedSyncTimestampRef.current === lastSyncTimestamp) return;
    refreshedSyncTimestampRef.current = lastSyncTimestamp;
    void refreshData().catch(error => {
      console.error('Canvas synced, but app data could not be refreshed:', error);
    });
  }, [isCanvasSyncing, lastSyncTimestamp, refreshData]);

  // Canvas URL input state (separate from saved settings)
  const [canvasUrlInput, setCanvasUrlInput] = useState('');
  const [canvasUrlSource, setCanvasUrlSource] = useState('');
  if (canvasUrlSource !== canvasSettings.icalUrl) {
    setCanvasUrlSource(canvasSettings.icalUrl);
    setCanvasUrlInput(canvasSettings.icalUrl);
  }
  const [feedSummary, setFeedSummary] = useState<{ url: string; courses: number } | null>(null);
  const feedCourseCount = feedSummary?.url === canvasSettings.icalUrl
    ? feedSummary.courses
    : null;
  const [isCanvasConnecting, setIsCanvasConnecting] = useState(false);
  const connectingFlowRef = useRef(false);
  const feedSummaryControllerRef = useRef<AbortController | null>(null);

  // Course enrollment cannot be inferred reliably from stored tasks because a
  // course may currently have no imported assignment. This endpoint reads the
  // count persisted by the last successful sync; it never refetches the private
  // provider feed merely to render this page. Manual sync still gets the request
  // slot to itself by aborting this lower-priority summary.
  useEffect(() => {
    if (!canvasSettings.icalUrl) return;
    if (isCanvasConnecting || isCanvasSyncing) return;

    const controller = new AbortController();
    feedSummaryControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
    const requestedUrl = canvasSettings.icalUrl;
    const loadFeedSummary = async () => {
      try {
        const response = await fetch('/api/canvas/sync', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const summary = await response.json();
        if (Number.isFinite(summary.courses)) {
          setFeedSummary({ url: requestedUrl, courses: summary.courses });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Could not load Canvas feed summary:', error);
      } finally {
        window.clearTimeout(timeoutId);
        if (feedSummaryControllerRef.current === controller) {
          feedSummaryControllerRef.current = null;
        }
      }
    };

    void loadFeedSummary();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      if (feedSummaryControllerRef.current === controller) {
        feedSummaryControllerRef.current = null;
      }
    };
  }, [canvasSettings.icalUrl, isCanvasConnecting, isCanvasSyncing, lastSyncTimestamp]);

  const stopFeedSummary = () => {
    feedSummaryControllerRef.current?.abort();
    feedSummaryControllerRef.current = null;
  };

  const handleCanvasSync = async () => {
    stopFeedSummary();
    await syncNow();
  };

  const handleCanvasConnect = async () => {
    if (!canvasUrlInput.trim() || connectingFlowRef.current) return;

    connectingFlowRef.current = true;
    setIsCanvasConnecting(true);
    stopFeedSummary();
    try {
      const connected = await setIcalUrl(canvasUrlInput);
      if (!connected) return;
      // The first import is explicit; subsequent automatic imports are handled
      // by the server scheduler even when this page or the browser is closed.
      await syncNow();
    } finally {
      connectingFlowRef.current = false;
      setIsCanvasConnecting(false);
    }
  };

  const canvasTasks = tasks.filter((task) => task.source === 'canvas');
  const canvasExams = exams.filter((exam) => exam.source === 'canvas');
  const now = currentTime.getTime();
  const upcomingCanvasTasks = canvasTasks.filter((task) => {
    if (task.status === 'completed' || !task.due_date) return false;
    const dueAt = new Date(task.due_date).getTime();
    return Number.isFinite(dueAt) && dueAt >= now;
  });
  const canvasCourseCount = new Set(
    canvasTasks
      .map((task) => {
        const canvasCourseId = task.external_url?.match(/\/courses?\/(\d+)/i)?.[1];
        if (canvasCourseId) return `canvas:${canvasCourseId}`;
        // The subject relation is the persisted course identity. Older Canvas
        // rows can have a valid subject_id even when course_name is blank.
        if (task.subject_id) return `subject:${task.subject_id}`;
        const courseName = task.course_name?.trim().toLowerCase();
        return courseName ? `name:${courseName}` : null;
      })
      .filter((courseIdentity): courseIdentity is string => Boolean(courseIdentity))
  ).size;

  const assignmentSummary = [
    { label: 'Assignments', value: canvasTasks.length, tone: 'text-sky-400' },
    {
      label: 'Upcoming',
      value: upcomingCanvasTasks.length,
      tone: 'text-emerald-400',
    },
    {
      label: 'Exams',
      value: canvasExams.length,
      tone: 'text-amber-400',
    },
    {
      label: 'Courses',
      // Existing rows receive course_count=0 during migration and are updated
      // on their next successful sync. Keep the locally loaded task identities
      // as a temporary lower bound so rollout never regresses to a false zero.
      value: Math.max(feedCourseCount ?? 0, canvasCourseCount),
      tone: 'text-violet-400',
    },
  ];

  let feedHost = 'Canvas calendar feed';
  try {
    if (canvasSettings.icalUrl) feedHost = new URL(canvasSettings.icalUrl).hostname;
  } catch {
    // Keep the friendly fallback if an older saved feed URL is malformed.
  }

  return (
    <MainLayout>
      <div className="workspace-page mx-auto max-w-5xl pb-10">
        <div className="workspace-header">
          <div>
            <p className="workspace-eyebrow">Connected tools</p>
            <h1 className="workspace-title">Canvas integration</h1>
            <p className="workspace-description">Your assignments and course details, kept in sync.</p>
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/settings">Back to Settings</Link></Button>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-5 py-6 sm:px-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-white">
                  <CanvasIcon className="h-8 w-8 text-[#e13f2a]" />
                  {canvasSettings.syncEnabled && canvasSettings.icalUrl && (
                    <motion.span
                      className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
                    />
                  )}
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">Canvas Sync</h2>
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${canvasSettings.icalUrl ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                      {canvasSettings.icalUrl ? 'Connected' : 'Not connected'}
                    </span>
                    {canvasSettings.icalUrl && (
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${canvasSettings.syncEnabled ? 'border-primary/20 bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                        {canvasSettings.syncEnabled ? 'Background sync on' : 'Sync paused'}
                      </span>
                    )}
                  </div>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                    {canvasSettings.icalUrl
                      ? 'Your Canvas calendar is securely connected and automatically updating Orderly.'
                      : 'Connect your Canvas calendar feed once, then let Orderly handle the updates.'}
                  </p>
                </div>
              </div>

              {canvasSettings.icalUrl && (
                <Button
                  onClick={handleCanvasSync}
                  disabled={isCanvasConnecting || isCanvasSyncing}
                  className="shrink-0"
                >
                  {isCanvasConnecting || isCanvasSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isCanvasSyncing ? 'Syncing…' : isCanvasConnecting ? 'Connecting…' : 'Sync now'}
                </Button>
              )}
            </div>
          </div>

          <CardContent className="space-y-6 p-5 sm:p-6">
            <AnimatePresence>
              {canvasError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{canvasError}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {isCanvasLoading ? (
              <div className="flex min-h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : canvasSettings.icalUrl ? (
              <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      {canvasSettings.syncEnabled ? <Clock className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                    </div>
                    <p className="text-xs text-muted-foreground">Next update</p>
                    <p className="mt-1 truncate text-sm font-semibold">
                      {isCanvasSyncing ? 'Syncing now…' : canvasSettings.syncEnabled ? (lastSyncAt ? countdown : 'Scheduled') : 'Paused'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-muted-foreground">Last synced</p>
                    <p className="mt-1 truncate text-sm font-semibold">{lastSyncDisplay}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Timer className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-muted-foreground">Sync interval</p>
                    <p className="mt-1 text-sm font-semibold">Every {canvasSettings.autoSyncInterval} minutes</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-muted-foreground">Imported</p>
                    <p className="mt-1 text-sm font-semibold">{canvasTasks.length} assignments</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <section className="rounded-xl border border-border p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${canvasSettings.syncEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {canvasSettings.syncEnabled ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                        </div>
                        <div>
                          <h3 className="font-semibold">Automatic updates</h3>
                          <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                            Keep Canvas assignments current in the background, even when Orderly is closed.
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleAutoSync}
                        className={canvasSettings.syncEnabled ? 'border-primary/25 bg-primary/5 text-primary hover:bg-primary/10' : ''}
                      >
                        {canvasSettings.syncEnabled ? 'On' : 'Turn on'}
                      </Button>
                    </div>

                    <div className="mt-6 border-t border-border pt-5">
                      <p className="mb-3 text-xs font-medium text-muted-foreground">Check Canvas every</p>
                      <div className="grid grid-cols-4 gap-2">
                        {[5, 15, 30, 60].map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            onClick={() => setSyncInterval(minutes)}
                            aria-pressed={canvasSettings.autoSyncInterval === minutes}
                            className={`rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors ${canvasSettings.autoSyncInterval === minutes ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/25 hover:text-foreground'}`}
                          >
                            {minutes}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <BookOpen className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold">Assignment overview</h3>
                        <p className="mt-1 text-xs text-muted-foreground">What Orderly is tracking from Canvas</p>
                      </div>
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
                      {assignmentSummary.map((item) => (
                        <div key={item.label} className="border-t border-border pt-3">
                          <p className="text-xl font-semibold tabular-nums">{item.value}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">Canvas calendar feed</p>
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">Connected securely through {feedHost}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearData}
                    className="justify-start text-red-400 hover:bg-red-400/10 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4">
                  <section className="rounded-xl border border-border bg-muted/20 p-5 md:p-6">
                    <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Link2 className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-semibold">Connect your calendar feed</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      Paste the private calendar feed URL from Canvas. Orderly only reads assignment information.
                    </p>
                    <label htmlFor="canvas-feed-url" className="mt-6 block text-xs font-medium text-muted-foreground">
                      Calendar feed URL
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="canvas-feed-url"
                        type="url"
                        placeholder="https://canvas.instructure.com/feeds/calendars/…"
                        value={canvasUrlInput}
                        onChange={(event) => setCanvasUrlInput(event.target.value)}
                        className="h-11 flex-1 bg-background"
                      />
                      <Button
                        onClick={handleCanvasConnect}
                        disabled={!canvasUrlInput.trim() || isCanvasConnecting || isCanvasSyncing}
                        className="h-11 px-5"
                      >
                        {isCanvasConnecting || isCanvasSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        {isCanvasSyncing ? 'Importing…' : isCanvasConnecting ? 'Connecting…' : 'Connect Canvas'}
                      </Button>
                    </div>
                  </section>

                </div>

                <div className="grid gap-3 border-t border-border pt-6 sm:grid-cols-3">
                  {[
                    { icon: ShieldCheck, title: 'Read-only connection', description: 'Orderly never changes Canvas.' },
                    { icon: RefreshCw, title: 'Background updates', description: 'Syncs even when the app is closed.' },
                    { icon: CheckCircle2, title: 'Automatic tasks', description: 'Assignments appear ready to organize.' },
                  ].map((feature) => (
                    <div key={feature.title} className="flex items-start gap-3 rounded-xl p-3">
                      <feature.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{feature.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <details open={!canvasSettings.icalUrl} className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer rounded-2xl px-5 py-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-6">
            Canvas connection guide
          </summary>
          <div className="border-t border-border px-5 py-5 sm:px-6">
            <p className="mb-5 text-sm text-muted-foreground">
              Follow these steps now, or return to this guide anytime.
            </p>
            <CanvasGuide />
          </div>
        </details>
      </div>
    </MainLayout>
  );
}
