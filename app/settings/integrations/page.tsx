'use client';

import { useState, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { useCanvasSyncSupabase, formatTimeUntilSync, formatLastSync } from '@/lib/integrations/useCanvasSyncSupabase';
import { useAppStore } from '@/lib/store';
import { useCurrentTime } from '@/lib/use-current-time';
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
      <div className="mx-auto max-w-6xl space-y-6 pb-10">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#ef553d]">Connections</p>
          <h1 className="text-3xl font-bold tracking-tight">Canvas integration</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Keep assignments, due dates, and course details up to date across Orderly.
          </p>
        </div>

        <Card className="overflow-hidden border-white/[0.08] bg-card/70 shadow-2xl shadow-black/10 backdrop-blur-xl">
          <div className="relative overflow-hidden border-b border-white/[0.08] px-6 py-7 md:px-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(234,68,47,0.2),transparent_42%)]" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-[#e13f2a]/10">
                  <CanvasIcon className="h-11 w-11 text-[#e13f2a]" />
                  {canvasSettings.syncEnabled && canvasSettings.icalUrl && (
                    <motion.span
                      className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-[3px] border-card bg-emerald-400"
                      animate={{ scale: [1, 1.12, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">Canvas Sync</h2>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${canvasSettings.icalUrl ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/5 text-muted-foreground'}`}>
                      {canvasSettings.icalUrl ? 'Connected' : 'Not connected'}
                    </span>
                    {canvasSettings.icalUrl && (
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${canvasSettings.syncEnabled ? 'border-sky-400/25 bg-sky-400/10 text-sky-300' : 'border-white/10 bg-white/5 text-muted-foreground'}`}>
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
                  className="shrink-0 bg-[#e13f2a] text-white shadow-lg shadow-[#e13f2a]/20 hover:bg-[#c93624]"
                >
                  {isCanvasConnecting || isCanvasSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isCanvasSyncing ? 'Syncing…' : isCanvasConnecting ? 'Connecting…' : 'Sync now'}
                </Button>
              )}
            </div>
          </div>

          <CardContent className="space-y-6 p-6 md:p-8">
            <AnimatePresence>
              {canvasError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-300"
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
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                      {canvasSettings.syncEnabled ? <Clock className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                    </div>
                    <p className="text-xs text-muted-foreground">Next update</p>
                    <p className="mt-1 truncate text-sm font-semibold">
                      {isCanvasSyncing ? 'Syncing now…' : canvasSettings.syncEnabled ? (lastSyncAt ? countdown : 'Scheduled') : 'Paused'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-muted-foreground">Last synced</p>
                    <p className="mt-1 truncate text-sm font-semibold">{lastSyncDisplay}</p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
                      <Timer className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-muted-foreground">Sync interval</p>
                    <p className="mt-1 text-sm font-semibold">Every {canvasSettings.autoSyncInterval} minutes</p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-muted-foreground">Imported</p>
                    <p className="mt-1 text-sm font-semibold">{canvasTasks.length} assignments</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${canvasSettings.syncEnabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-muted-foreground'}`}>
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
                        className={canvasSettings.syncEnabled ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200' : ''}
                      >
                        {canvasSettings.syncEnabled ? 'On' : 'Turn on'}
                      </Button>
                    </div>

                    <div className="mt-6 border-t border-white/[0.07] pt-5">
                      <p className="mb-3 text-xs font-medium text-muted-foreground">Check Canvas every</p>
                      <div className="grid grid-cols-4 gap-2">
                        {[5, 15, 30, 60].map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            onClick={() => setSyncInterval(minutes)}
                            className={`rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors ${canvasSettings.autoSyncInterval === minutes ? 'border-[#e13f2a]/40 bg-[#e13f2a]/12 text-[#ff806d]' : 'border-white/[0.08] bg-black/10 text-muted-foreground hover:border-white/15 hover:text-foreground'}`}
                          >
                            {minutes}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
                        <BookOpen className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold">Assignment overview</h3>
                        <p className="mt-1 text-xs text-muted-foreground">What Orderly is tracking from Canvas</p>
                      </div>
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
                      {assignmentSummary.map((item) => (
                        <div key={item.label} className="border-t border-white/[0.07] pt-3">
                          <p className={`text-2xl font-semibold ${item.tone}`}>{item.value}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-black/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted-foreground">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">Canvas calendar feed</p>
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
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
                <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 md:p-6">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#e13f2a]/10 text-[#ff735e]">
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
                        className="h-11 flex-1 bg-black/10"
                      />
                      <Button
                        onClick={handleCanvasConnect}
                        disabled={!canvasUrlInput.trim() || isCanvasConnecting || isCanvasSyncing}
                        className="h-11 bg-[#e13f2a] px-5 text-white hover:bg-[#c93624]"
                      >
                        {isCanvasConnecting || isCanvasSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        {isCanvasSyncing ? 'Importing…' : isCanvasConnecting ? 'Connecting…' : 'Connect Canvas'}
                      </Button>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 md:p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Where to find it</p>
                    <ol className="mt-5 space-y-4">
                      {[
                        ['1', 'Open Canvas Calendar', 'Select Calendar from the Canvas navigation.'],
                        ['2', 'Choose Calendar Feed', 'Find the Calendar Feed link at the bottom right.'],
                        ['3', 'Copy and paste', 'Copy the full URL and paste it into Orderly.'],
                      ].map(([step, title, description]) => (
                        <li key={step} className="flex gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e13f2a]/10 text-xs font-semibold text-[#ff735e]">{step}</span>
                          <div>
                            <p className="text-sm font-medium">{title}</p>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>

                <div className="grid gap-3 border-t border-white/[0.07] pt-6 sm:grid-cols-3">
                  {[
                    { icon: ShieldCheck, title: 'Read-only connection', description: 'Orderly never changes Canvas.' },
                    { icon: RefreshCw, title: 'Background updates', description: 'Syncs even when the app is closed.' },
                    { icon: CheckCircle2, title: 'Automatic tasks', description: 'Assignments appear ready to organize.' },
                  ].map((feature) => (
                    <div key={feature.title} className="flex items-start gap-3 rounded-xl p-3">
                      <feature.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#ff735e]" />
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
      </div>
    </MainLayout>
  );
}
