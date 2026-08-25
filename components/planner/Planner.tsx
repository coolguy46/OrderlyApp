'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, differenceInMinutes, format, isAfter, startOfDay } from 'date-fns';
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { usePlannerStore } from '@/lib/planner/store';
import {
  buildDeterministicPlannerInterpretation,
  sanitizePlannerInterpretInput,
  type PlannerInterpretResult,
} from '@/lib/planner/intent';
import {
  estimatePlannerTask,
  getPlannerStaleness,
} from '@/lib/planner/engine';
import {
  examsToPlannerInputs,
  readStoredCalendarEvents,
  storedEventsToCommitments,
  tasksToPlannerInputs,
  type StoredCalendarEvent,
} from '@/lib/planner/adapters';
import type {
  PlannerBlock,
  PlannerChatMessage,
  PlannerEstimateCacheEntry,
  PlannerFeedbackRecord,
  PlannerSettings,
  PlannerTaskInput,
  RecurringCommitmentInput,
  TimingRating,
} from '@/lib/planner/types';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TaskDetailViewer } from '@/components/tasks/TaskDetailViewer';
import {
  DailyTaskPanel,
  PlanBlockEditor,
  PlannerFullscreen,
  PlannerPrompt,
  WeekTimeGrid,
  type PlannerBlockView,
  type PlannerDayTaskView,
} from '@/components/planner';
import {
  isVirtualPlannerOccurrence,
  plannerBlockMatchesTaskCompletion,
  plannerBlockViews,
  plannerDayTasks,
  plannerFeedbackEntityKey,
} from './adapters';

const PROMPT_PREFIX = 'prompt-constraint-';
const CALENDAR_PREFIX = 'calendar-';

function uniqueCommitments(commitments: readonly RecurringCommitmentInput[]) {
  return [...new Map(commitments.map(commitment => [commitment.id, commitment])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
}

function promptCommitments(
  intent: PlannerInterpretResult['intent'],
  settings: PlannerSettings,
): RecurringCommitmentInput[] {
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const constraints: RecurringCommitmentInput[] = [];
  const addConstraint = (
    id: string,
    title: string,
    daysOfWeek: number[],
    startTime: string,
    endTime: string,
  ) => {
    if (startTime === endTime) return;
    constraints.push({
      id: `${PROMPT_PREFIX}${id}`,
      title,
      kind: 'personal',
      daysOfWeek,
      startTime,
      endTime,
      enabled: true,
      timeZone: settings.timeZone,
      color: '#8b5cf6',
    });
  };

  intent.avoidDays.forEach(day => addConstraint(
    `avoid-${day}`,
    'Kept free by your Planner request',
    [day],
    '00:00',
    '23:59',
  ));
  intent.lighterDays.forEach(day => addConstraint(
    `lighter-${day}`,
    'Lighter evening requested',
    [day],
    '19:00',
    '23:59',
  ));
  if (intent.preferredStart) {
    addConstraint('preferred-start', 'No planned work before this time', allDays, '00:00', intent.preferredStart);
  }
  if (intent.preferredEnd) {
    addConstraint('preferred-end', 'Evening kept free', allDays, intent.preferredEnd, '23:59');
  }
  return constraints;
}

function effectiveSettings(
  settings: PlannerSettings,
  intent: PlannerInterpretResult['intent'],
): PlannerSettings {
  if (!intent.sessionMinutes) return settings;
  return {
    ...settings,
    maxBlockMinutes: Math.max(15, Math.min(90, Math.round(intent.sessionMinutes / 15) * 15)),
  };
}

function planSummary(result: PlannerInterpretResult, blockCount: number, unscheduledMinutes: number) {
  const scheduled = `${blockCount} time block${blockCount === 1 ? '' : 's'}`;
  const warning = unscheduledMinutes > 0
    ? ` I still need ${unscheduledMinutes} unscheduled minute${unscheduledMinutes === 1 ? '' : 's'} reviewed because the week is too full.`
    : '';
  return `${result.summary} I built ${scheduled} around exact deadlines and your busy times.${warning}`;
}

export function Planner() {
  const { user, tasks, exams, subjects, completeTask, updateTask } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const generatePlan = usePlannerStore(state => state.generatePlan);
  const archiveCurrentPlan = usePlannerStore(state => state.archiveCurrentPlan);
  const moveBlock = usePlannerStore(state => state.moveBlock);
  const resizeBlock = usePlannerStore(state => state.resizeBlock);
  const updateBlock = usePlannerStore(state => state.updateBlock);
  const deleteBlock = usePlannerStore(state => state.deleteBlock);
  const addMessage = usePlannerStore(state => state.addMessage);
  const cacheEstimate = usePlannerStore(state => state.cacheEstimate);
  const recordFeedback = usePlannerStore(state => state.recordFeedback);

  const userId = user?.id || null;
  const record = userId ? plannerUsers[userId] : null;
  const plan = record?.currentPlan || null;
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [storedEvents, setStoredEvents] = useState<StoredCalendarEvent[]>([]);
  const [generating, setGenerating] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<PlannerBlockView | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [feedbackBlockId, setFeedbackBlockId] = useState<string | null>(null);
  const [feedbackTiming, setFeedbackTiming] = useState<TimingRating | null>(null);
  const [feedbackHappy, setFeedbackHappy] = useState<boolean | null>(null);
  const [feedbackNow, setFeedbackNow] = useState(() => Date.now());
  const [skippedFeedbackKeys, setSkippedFeedbackKeys] = useState<Set<string>>(new Set());
  const handledFeedbackQuery = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setActiveUser(userId, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, userId]);

  useEffect(() => {
    const refresh = () => setStoredEvents(readStoredCalendarEvents());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('orderly-calendar-events-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('orderly-calendar-events-changed', refresh);
    };
  }, []);

  useEffect(() => {
    if (plan) setSelectedDate(startOfDay(new Date(plan.horizonStart)));
    setFeedbackBlockId(null);
    setFeedbackTiming(null);
    setFeedbackHappy(null);
    setSkippedFeedbackKeys(new Set());
    handledFeedbackQuery.current = null;
  }, [plan?.id]);

  useEffect(() => {
    setFeedbackNow(Date.now());
    if (!plan) return;
    const interval = window.setInterval(() => setFeedbackNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [plan?.id]);

  const plannerTimeZone = record?.settings.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const taskInputs = useMemo(
    () => tasksToPlannerInputs(
      tasks.filter(task => task.status !== 'completed'),
      {
        // Keep the virtual occurrence set stable while an existing plan crosses
        // midnight; a newly generated week falls back to the current instant.
        horizonStart: plan?.horizonStart || new Date(),
        horizonDays: plan?.settings.horizonDays || record?.settings.horizonDays || 7,
        timeZone: plannerTimeZone,
      },
    ),
    [plan?.horizonStart, plan?.settings.horizonDays, plannerTimeZone, record?.settings.horizonDays, tasks],
  );
  const examInputs = useMemo(
    () => examsToPlannerInputs(exams
      .filter(exam => {
        const timestamp = new Date(exam.exam_date).getTime();
        return Number.isFinite(timestamp) && timestamp >= startOfDay(new Date()).getTime();
      }), taskInputs),
    [exams, taskInputs],
  );
  const calendarCommitments = useMemo(
    () => storedEventsToCommitments(
      storedEvents,
      plannerTimeZone,
    ),
    [plannerTimeZone, storedEvents],
  );
  const liveCommitments = useMemo(() => uniqueCommitments([
    ...(record?.commitments || []).filter(commitment => !commitment.id.startsWith(CALENDAR_PREFIX)),
    ...calendarCommitments,
  ]), [calendarCommitments, record?.commitments]);

  const generationRequest = useMemo(() => ({
    tasks: taskInputs,
    exams: examInputs,
    commitments: liveCommitments,
    settings: record?.settings,
    prompt: plan?.prompt || null,
    focusSubjects: plan?.focusSubjects || [],
  }), [examInputs, liveCommitments, plan?.focusSubjects, plan?.prompt, record?.settings, taskInputs]);

  const staleness = useMemo(() => {
    if (!plan || !record || !userId) return null;
    return getPlannerStaleness(plan, {
      userId,
      tasks: generationRequest.tasks,
      exams: generationRequest.exams,
      commitments: generationRequest.commitments,
      settings: record.settings,
      estimateCache: record.estimateCache,
      feedbackMultipliers: record.feedbackMultipliers,
      prompt: plan.prompt,
      focusSubjects: plan.focusSubjects || [],
    });
  }, [generationRequest, plan, record, userId]);

  const blockViews = useMemo(() => plannerBlockViews(plan, subjects, tasks), [plan, subjects, tasks]);
  const dayTasks = useMemo(
    () => plannerDayTasks(plan, selectedDate, tasks, subjects),
    [plan, selectedDate, subjects, tasks],
  );
  const detailTask = detailTaskId ? tasks.find(task => task.id === detailTaskId) || null : null;
  const planExpired = plan ? isAfter(new Date(), new Date(plan.horizonEnd)) : false;
  const reviewedFeedbackKeys = useMemo(() => {
    const keys = new Set<string>();
    (record?.feedback || []).forEach(item => {
      const referencedBlock = item.blockId
        ? plan?.blocks.find(block => block.id === item.blockId)
        : null;
      if (referencedBlock) keys.add(plannerFeedbackEntityKey(referencedBlock));
      else if (item.taskId) keys.add(`task:${item.taskId}`);
      else if (item.examId) keys.add(`exam:${item.examId}`);
      else if (item.blockId) keys.add(`block:${item.blockId}`);
    });
    return keys;
  }, [plan, record?.feedback]);
  const completedTaskById = useMemo(
    () => new Map(tasks.filter(task => task.status === 'completed').map(task => [task.id, task])),
    [tasks],
  );
  const isFeedbackEligible = useCallback((block: PlannerBlock) => {
    const entityKey = plannerFeedbackEntityKey(block);
    if (reviewedFeedbackKeys.has(entityKey) || skippedFeedbackKeys.has(entityKey)) return false;
    const completedTask = block.taskId ? completedTaskById.get(block.taskId) : null;
    const sourceHasEnded = Boolean(plan?.blocks
      .filter(item => item.sourceId === block.sourceId)
      .every(item => new Date(item.endAt).getTime() <= feedbackNow));
    return block.status === 'completed'
      || plannerBlockMatchesTaskCompletion(block, completedTask, plan?.settings.timeZone || 'UTC')
      || sourceHasEnded;
  }, [completedTaskById, feedbackNow, plan, reviewedFeedbackKeys, skippedFeedbackKeys]);
  const feedbackCandidate = useMemo(() => {
    if (!plan) return null;
    return plan.blocks
      .filter(isFeedbackEligible)
      .sort((left, right) => {
        const leftTask = left.taskId ? completedTaskById.get(left.taskId) : null;
        const rightTask = right.taskId ? completedTaskById.get(right.taskId) : null;
        const leftCompletedAt = plannerBlockMatchesTaskCompletion(left, leftTask, plan.settings.timeZone)
          ? leftTask?.completed_at
          : null;
        const rightCompletedAt = plannerBlockMatchesTaskCompletion(right, rightTask, plan.settings.timeZone)
          ? rightTask?.completed_at
          : null;
        const completionDifference = new Date(rightCompletedAt || right.endAt).getTime()
          - new Date(leftCompletedAt || left.endAt).getTime();
        return completionDifference || right.segmentIndex - left.segmentIndex || right.id.localeCompare(left.id);
      })[0] || null;
  }, [completedTaskById, isFeedbackEligible, plan]);

  useEffect(() => {
    if (!plan) return;
    const requestedBlockId = new URLSearchParams(window.location.search).get('feedback');
    if (!requestedBlockId) return;
    const queryKey = `${plan.id}:${requestedBlockId}`;
    if (handledFeedbackQuery.current === queryKey) return;
    handledFeedbackQuery.current = queryKey;
    const requestedBlock = plan.blocks.find(block => block.id === requestedBlockId);
    if (requestedBlock && isFeedbackEligible(requestedBlock)) {
      setFeedbackBlockId(requestedBlock.id);
    }
  }, [isFeedbackEligible, plan]);

  const cacheAIResults = useCallback((result: PlannerInterpretResult, inputs: readonly PlannerTaskInput[]) => {
    if (!userId || !result.aiUsed) return;
    const now = new Date().toISOString();
    const cachedTaskIds = new Set<string>();
    inputs.forEach(task => {
      const originalTaskId = task.taskId || task.id;
      if (cachedTaskIds.has(originalTaskId)) return;
      cachedTaskIds.add(originalTaskId);
      const estimate = result.estimates[originalTaskId] || result.estimates[task.id];
      if (!estimate) return;
      const fingerprint = estimatePlannerTask(task).contentFingerprint;
      const entry: PlannerEstimateCacheEntry = {
        entityId: `task:${originalTaskId}`,
        contentFingerprint: fingerprint,
        minutes: estimate.minutes,
        source: 'ai',
        model: 'deepseek-v4-flash',
        promptVersion: 'planner-interpret-v1',
        explanation: estimate.reason,
        createdAt: now,
      };
      cacheEstimate(userId, entry);
    });
  }, [cacheEstimate, userId]);

  const interpret = useCallback(async (prompt: string): Promise<PlannerInterpretResult> => {
    const body = {
      prompt,
      // A repeating task only needs one AI interpretation. Its virtual dated
      // occurrences reuse this estimate through their original task ID.
      tasks: [...new Map(taskInputs.map(task => {
        const id = task.taskId || task.id;
        return [id, {
          id,
          title: task.title,
          description: task.description || '',
          priority: task.priority,
          assignmentType: task.assignmentType || null,
          courseName: task.courseName || null,
          dueAt: task.dueAt || null,
        }] as const;
      })).values()],
      exams: examInputs.map(exam => ({
        id: exam.id,
        title: exam.title,
        description: exam.description || '',
        subject: subjects.find(subject => subject.id === exam.subjectId)?.name || null,
        examAt: exam.examAt,
      })),
      currentSettings: record?.settings || {},
    };
    try {
      const response = await fetch('/api/planner/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Interpretation failed');
      return await response.json() as PlannerInterpretResult;
    } catch {
      return buildDeterministicPlannerInterpretation(sanitizePlannerInterpretInput(body));
    }
  }, [examInputs, record?.settings, subjects, taskInputs]);

  const createPlan = useCallback(async (prompt: string) => {
    if (!userId || !record || generating) return;
    setGenerating(true);
    addMessage(userId, { role: 'user', content: prompt });
    try {
      const result = await interpret(prompt);
      cacheAIResults(result, taskInputs);
      const baseCommitments = liveCommitments.filter(commitment => !commitment.id.startsWith(PROMPT_PREFIX));
      const settings = effectiveSettings(record.settings, result.intent);
      const commitments = uniqueCommitments([
        ...baseCommitments,
        ...promptCommitments(result.intent, settings),
      ]);
      const nextPlan = generatePlan(userId, {
        tasks: taskInputs,
        exams: examInputs,
        commitments,
        settings,
        prompt,
        focusSubjects: result.intent.focusSubjects,
      });
      addMessage(userId, {
        role: 'assistant',
        content: planSummary(result, nextPlan.blocks.length, nextPlan.totalUnscheduledMinutes),
      });
      setSelectedDate(startOfDay(new Date(nextPlan.horizonStart)));
      toast.success('Your one-week plan is ready', {
        description: `${nextPlan.blocks.length} blocks scheduled${result.aiUsed ? ' with DeepSeek estimates' : ' with deterministic estimates'}.`,
      });
    } catch (error) {
      toast.error('Orderly could not build the plan', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setGenerating(false);
    }
  }, [addMessage, cacheAIResults, examInputs, generatePlan, generating, interpret, liveCommitments, record, taskInputs, userId]);

  const updateStalePlan = () => void createPlan(plan?.prompt || 'Update my week with the new assignments');

  const handleMove = (view: PlannerBlockView, nextStart: Date) => {
    if (!userId) return;
    const result = moveBlock(userId, view.id, nextStart.toISOString());
    if (!result.ok) toast.error(result.error || 'That block could not be moved.');
  };

  const handleResize = (view: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const result = resizeBlock(userId, view.id, differenceInMinutes(nextEnd, nextStart));
    if (!result.ok) toast.error(result.error || 'That block could not be resized.');
  };

  const handleEditorSave = async (view: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const result = updateBlock(userId, view.id, {
      startAt: nextStart.toISOString(),
      endAt: nextEnd.toISOString(),
    });
    if (!result.ok) {
      toast.error(result.error || 'That block could not be updated.');
      throw new Error(result.error);
    }
  };

  const handleDeleteBlock = async (view: PlannerBlockView) => {
    if (!userId) return;
    const result = deleteBlock(userId, view.id);
    if (!result.ok) {
      toast.error(result.error || 'That block could not be removed.');
      throw new Error(result.error);
    }
    toast.success('Block removed');
  };

  const openTaskFromBlock = (view: PlannerBlockView | PlannerDayTaskView) => {
    if (!plan) return;
    const block = plan.blocks.find(item => item.id === view.id);
    if (block?.taskId) setDetailTaskId(block.taskId);
  };

  const toggleDayTask = async (view: PlannerDayTaskView) => {
    if (!plan || !userId) return;
    const block = plan.blocks.find(item => item.id === view.id);
    if (!block) return;
    if (block.taskId) {
      const task = tasks.find(item => item.id === block.taskId);
      const taskCompletionApplies = plannerBlockMatchesTaskCompletion(
        block,
        task,
        plan.settings.timeZone,
      );
      if (block.status === 'completed' || taskCompletionApplies) {
        if (taskCompletionApplies && isVirtualPlannerOccurrence(block)) {
          toast.info('This recurring occurrence already advanced', {
            description: 'Update the stale plan to use the newly created recurring task.',
          });
          return;
        }
        if (taskCompletionApplies && task) {
          await updateTask(task.id, { status: 'pending', completed_at: null });
        }
        plan.blocks.filter(item => item.sourceId === block.sourceId).forEach(item => {
          updateBlock(userId, item.id, { status: 'planned' });
        });
      } else {
        // Completing a recurring row creates its next durable occurrence. If
        // this stale plan still contains later virtual occurrences from the old
        // row, keep their completion local until the user refreshes the plan
        // instead of creating the same next task twice.
        if (!(isVirtualPlannerOccurrence(block) && task?.status === 'completed')) {
          await completeTask(block.taskId);
        }
        plan.blocks.filter(item => item.sourceId === block.sourceId).forEach(item => {
          updateBlock(userId, item.id, { status: 'completed' });
        });
        setFeedbackBlockId(block.id);
      }
    } else {
      updateBlock(userId, block.id, { status: block.status === 'completed' ? 'planned' : 'completed' });
      if (block.status !== 'completed') setFeedbackBlockId(block.id);
    }
  };

  const dismissFeedback = (rememberForSession: boolean) => {
    if (rememberForSession && feedbackBlockId && plan) {
      const block = plan.blocks.find(item => item.id === feedbackBlockId);
      if (block) {
        setSkippedFeedbackKeys(current => new Set(current).add(plannerFeedbackEntityKey(block)));
      }
    }
    setFeedbackBlockId(null);
    setFeedbackTiming(null);
    setFeedbackHappy(null);
  };

  const saveFeedback = () => {
    if (!userId || !plan || !feedbackBlockId || !feedbackTiming) return;
    const block = plan.blocks.find(item => item.id === feedbackBlockId);
    if (!block) return;
    const feedback: PlannerFeedbackRecord = {
      id: '',
      planId: plan.id,
      blockId: block.id,
      taskId: block.taskId,
      examId: block.examId,
      subjectId: block.subjectId,
      assignmentType: block.assignmentType,
      predictedMinutes: block.estimatedMinutes,
      actualMinutes: null,
      timingRating: feedbackTiming,
      scheduleRating: feedbackHappy === null ? null : feedbackHappy ? 5 : 2,
      createdAt: '',
    };
    const result = recordFeedback(userId, feedback);
    if (result.ok) {
      toast.success('Thanks — future estimates will learn from this.');
      dismissFeedback(false);
    } else {
      toast.error(result.error || 'Feedback could not be saved.');
    }
  };

  const archivePlan = () => {
    if (!userId) return;
    const result = archiveCurrentPlan(userId);
    if (result.ok) toast.success('Plan archived', { description: 'You can create a fresh week without losing this one.' });
  };

  if (!userId || !record) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading your Planner…</div>;
  }

  const editorBlock = selectedBlock && blockViews.some(block => block.id === selectedBlock.id)
    ? blockViews.find(block => block.id === selectedBlock.id) || null
    : null;
  const feedbackBlock = feedbackBlockId ? plan?.blocks.find(block => block.id === feedbackBlockId) || null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2 shadow-lg shadow-indigo-500/20">
              <CalendarClock className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-display sm:text-2xl">Weekly Planner</h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                One realistic week, fitted around everything already on your calendar.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setArchiveOpen(true)}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </Button>
          )}
          <Button size="sm" className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white" onClick={() => void createPlan(plan ? 'Replan my week' : 'Plan my week')} disabled={generating}>
            {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
            {plan ? 'Replan week' : 'Plan my week'}
          </Button>
        </div>
      </div>

      {staleness?.isStale && (
        <Card className="border-amber-500/30 bg-amber-500/8">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-semibold">Your plan does not include the latest changes</p>
                <p className="text-xs text-muted-foreground">
                  {staleness.summary.join(', ') || 'Tasks or availability changed'} — review it before Orderly moves anything.
                </p>
              </div>
            </div>
            <Button size="sm" className="shrink-0 gap-1.5" onClick={updateStalePlan} disabled={generating}>
              <RefreshCw className="h-3.5 w-3.5" /> Update plan
            </Button>
          </CardContent>
        </Card>
      )}

      {planExpired && (
        <Card className="border-indigo-500/25 bg-indigo-500/8">
          <CardContent className="flex items-center justify-between gap-3 p-3 sm:p-4">
            <div>
              <p className="text-sm font-semibold">This planned week has ended</p>
              <p className="text-xs text-muted-foreground">It stays in history. Start a fresh plan when you are ready.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void createPlan('Plan my next week')}>Plan next week</Button>
          </CardContent>
        </Card>
      )}

      {feedbackCandidate && !feedbackBlockId && (
        <button
          type="button"
          onClick={() => setFeedbackBlockId(feedbackCandidate.id)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/7 px-3 py-2.5 text-left transition-colors hover:bg-emerald-500/10"
        >
          <span className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            How did “{feedbackCandidate.title}” go? Your answer improves future timing.
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {plan ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(300px,.75fr)_minmax(0,1.6fr)]">
          <DailyTaskPanel
            planStart={plan.horizonStart}
            selectedDate={selectedDate}
            tasks={dayTasks}
            onSelectedDateChange={setSelectedDate}
            onTaskClick={openTaskFromBlock}
            onTaskToggle={toggleDayTask}
          />
          <div className="min-w-0 space-y-4">
            <Card className="overflow-hidden border-border/50">
              <CardContent className="p-2 sm:p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <div>
                    <p className="text-sm font-semibold font-display">
                      {format(new Date(plan.horizonStart), 'MMM d')} – {format(addDays(startOfDay(new Date(plan.horizonStart)), 6), 'MMM d')}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Drag to move · pull the bottom edge to resize · click for exact times</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1 text-[10px]"><Clock3 className="h-3 w-3" /> {Math.round(plan.totalScheduledMinutes / 60 * 10) / 10}h planned</Badge>
                    {plan.warnings.length > 0 && <Badge className="bg-amber-500/15 text-amber-400">{plan.warnings.length} warning{plan.warnings.length === 1 ? '' : 's'}</Badge>}
                  </div>
                </div>
                <WeekTimeGrid
                  weekStart={plan.horizonStart}
                  blocks={blockViews}
                  editable={!planExpired}
                  timeZoneLabel={plan.settings.timeZone}
                  onBlockMove={handleMove}
                  onBlockResize={handleResize}
                  onBlockClick={setSelectedBlock}
                  onRequestFullscreen={() => setFullscreen(true)}
                />
              </CardContent>
            </Card>
            <PlannerPrompt
              messages={record.messages}
              onSubmit={createPlan}
              isSubmitting={generating}
              suggestions={[
                'Plan my week',
                'Make Tuesday lighter',
                'Do not schedule anything after 9 pm',
                'Use 45 minute blocks and focus on Calculus',
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(300px,.75fr)_minmax(0,1.6fr)]">
          <Card className="min-h-[430px] border-dashed border-border/70">
            <CardContent className="flex h-full min-h-[430px] flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 rounded-2xl bg-indigo-500/10 p-4"><Sparkles className="h-8 w-8 text-indigo-400" /></div>
              <h2 className="text-lg font-semibold font-display">Your week is ready to be solved</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Orderly will read pending task and Canvas descriptions, account for exams, school, and calendar events, then fit work before every exact deadline.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline">Maximum 7 days</Badge>
                <Badge variant="outline">15-minute precision</Badge>
                <Badge variant="outline">Editable blocks</Badge>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card className="overflow-hidden border-border/50">
              <CardContent className="relative flex min-h-[360px] items-center justify-center p-8">
                <div className="absolute inset-0 opacity-35" style={{ backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)', backgroundSize: '14.285% 60px' }} />
                <div className="relative z-10 rounded-2xl border border-border/60 bg-card/90 p-5 text-center shadow-xl backdrop-blur">
                  <CalendarClock className="mx-auto h-7 w-7 text-indigo-400" />
                  <p className="mt-2 text-sm font-semibold">No active plan yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Type below or click “Plan my week.”</p>
                </div>
              </CardContent>
            </Card>
            <PlannerPrompt messages={record.messages} onSubmit={createPlan} isSubmitting={generating} />
          </div>
        </div>
      )}

      {plan?.warnings.length ? (
        <Card className="border-amber-500/20">
          <CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-400" /> Plan checks</p>
            {plan.warnings.slice(0, 6).map(warning => (
              <div key={warning.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2 text-xs">
                <div><p className="font-medium">{warning.title}</p><p className="text-muted-foreground">{warning.message}</p></div>
                {warning.deadlineAt && <span className="shrink-0 text-[10px] text-muted-foreground">{format(new Date(warning.deadlineAt), 'MMM d, h:mm a')}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {plan && (
        <PlannerFullscreen
          open={fullscreen}
          onOpenChange={setFullscreen}
          weekStart={plan.horizonStart}
          blocks={blockViews}
          editable={!planExpired}
          timeZoneLabel={plan.settings.timeZone}
          onBlockMove={handleMove}
          onBlockResize={handleResize}
          onBlockClick={setSelectedBlock}
        />
      )}

      <PlanBlockEditor
        block={editorBlock}
        open={Boolean(editorBlock)}
        onOpenChange={open => !open && setSelectedBlock(null)}
        onSave={handleEditorSave}
        onRemove={handleDeleteBlock}
        onViewTask={openTaskFromBlock}
        readOnly={planExpired}
      />

      <TaskDetailViewer task={detailTask} open={Boolean(detailTask)} onOpenChange={open => !open && setDetailTaskId(null)} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this weekly plan?"
        description="It will leave your active Planner but remain in history, and repeating the same request can restore the same plan."
        confirmLabel="Archive plan"
        variant="warning"
        onConfirm={archivePlan}
      />

      <Dialog open={Boolean(feedbackBlock)} onOpenChange={open => {
        if (!open) dismissFeedback(true);
      }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>How did this timing feel?</DialogTitle>
            <DialogDescription>{feedbackBlock?.title} · {feedbackBlock?.estimatedMinutes} minutes planned</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            <div>
              <p className="mb-2 text-sm font-medium">Was the time estimate accurate?</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['too_short', 'Needed more'],
                  ['accurate', 'About right'],
                  ['too_long', 'Needed less'],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setFeedbackTiming(value)} className={`rounded-xl border px-2 py-3 text-xs font-medium transition-colors ${feedbackTiming === value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/50'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Were you happy with when it was scheduled?</p>
              <div className="flex gap-2">
                <Button type="button" variant={feedbackHappy === true ? 'default' : 'outline'} className="flex-1 gap-2" onClick={() => setFeedbackHappy(true)}><ThumbsUp className="h-4 w-4" /> Yes</Button>
                <Button type="button" variant={feedbackHappy === false ? 'default' : 'outline'} className="flex-1 gap-2" onClick={() => setFeedbackHappy(false)}><ThumbsDown className="h-4 w-4" /> Not really</Button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => dismissFeedback(true)}>Skip</Button>
              <Button onClick={saveFeedback} disabled={!feedbackTiming}>Save feedback</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
