'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { usePlannerStore } from '@/lib/planner/store';
import { Button } from '@/components/ui/Button';
import {
  plannerBlockMatchesTaskCompletion,
  plannerFeedbackEntityKey,
} from './adapters';
import { useHydrated } from '@/lib/use-hydrated';

function dismissalStorageKey(userId: string): string {
  return `orderly-planner-feedback-dismissed-${userId}`;
}

function readDismissed(userId: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(dismissalStorageKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * A lightweight cross-app invitation. The actual questions stay in /planner so
 * task cards and dashboard lists do not need to duplicate Planner feedback UI.
 */
export function PlannerFeedbackNudge() {
  const pathname = usePathname();
  const { user, tasks } = useAppStore();
  const plannerRecord = usePlannerStore(state => user ? state.users[user.id] : undefined);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const hydrated = useHydrated();
  const dismissedUserId = hydrated ? user?.id || '' : '';
  const [loadedDismissalsFor, setLoadedDismissalsFor] = useState('');
  if (loadedDismissalsFor !== dismissedUserId) {
    setLoadedDismissalsFor(dismissedUserId);
    setDismissed(new Set(dismissedUserId ? readDismissed(dismissedUserId) : []));
  }

  const candidate = useMemo(() => {
    const plan = plannerRecord?.currentPlan;
    if (!plan) return null;
    const completedTasks = new Map(
      tasks
        .filter(task => task.status === 'completed')
        .map(task => [task.id, task]),
    );
    const reviewedKeys = new Set<string>();
    plannerRecord.feedback.forEach(feedback => {
      const referencedBlock = feedback.blockId
        ? plan.blocks.find(block => block.id === feedback.blockId)
        : null;
      if (referencedBlock) reviewedKeys.add(plannerFeedbackEntityKey(referencedBlock));
      else if (feedback.taskId) reviewedKeys.add(`task:${feedback.taskId}`);
      else if (feedback.examId) reviewedKeys.add(`exam:${feedback.examId}`);
      else if (feedback.blockId) reviewedKeys.add(`block:${feedback.blockId}`);
    });
    const taskCandidates = plan.blocks
      .filter(block => {
        const task = block.taskId ? completedTasks.get(block.taskId) : null;
        return plannerBlockMatchesTaskCompletion(block, task, plan.settings.timeZone);
      })
      .filter(block => !reviewedKeys.has(plannerFeedbackEntityKey(block)))
      .filter(block => !dismissed.has(plannerFeedbackEntityKey(block)))
      .sort((left, right) => {
        const leftTask = left.taskId ? completedTasks.get(left.taskId) : null;
        const rightTask = right.taskId ? completedTasks.get(right.taskId) : null;
        const completedDifference = new Date(rightTask?.completed_at || right.endAt).getTime()
          - new Date(leftTask?.completed_at || left.endAt).getTime();
        return completedDifference || new Date(right.endAt).getTime() - new Date(left.endAt).getTime();
      });

    // A split task should ask once, using its latest planned segment.
    const firstByTask = new Map<string, (typeof taskCandidates)[number]>();
    taskCandidates.forEach(block => {
      const key = plannerFeedbackEntityKey(block);
      if (!firstByTask.has(key)) firstByTask.set(key, block);
    });
    return firstByTask.values().next().value || null;
  }, [dismissed, plannerRecord, tasks]);

  if (!user || pathname.startsWith('/planner') || !candidate) return null;

  const dismissalKey = plannerFeedbackEntityKey(candidate);
  const dismiss = () => {
    const next = new Set(dismissed).add(dismissalKey);
    setDismissed(next);
    try {
      localStorage.setItem(dismissalStorageKey(user.id), JSON.stringify([...next].slice(-100)));
    } catch {
      // Storage can be unavailable in privacy mode; the in-memory dismissal still works.
    }
  };

  return (
    <AnimatePresence>
      <motion.aside
        key={candidate.id}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        role="status"
        aria-live="polite"
        className="fixed bottom-16 right-3 z-50 w-[min(360px,calc(100vw-1.5rem))] rounded-2xl border border-indigo-500/25 bg-card/95 p-3.5 shadow-2xl shadow-black/20 backdrop-blur-xl lg:bottom-5 lg:right-5"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Help Orderly learn your timing</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  You completed “{candidate.title}.” Was its planned time accurate?
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss timing feedback invitation"
                className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button asChild size="sm" className="h-8 gap-1.5">
                <Link href={`/planner?feedback=${encodeURIComponent(candidate.id)}`}>
                  Review in Planner <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={dismiss}>
                Not now
              </Button>
            </div>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
