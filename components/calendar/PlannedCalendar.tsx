'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Expand,
  PencilLine,
  Sparkles,
} from 'lucide-react';
import { TaskDetailViewer } from '@/components/tasks/TaskDetailViewer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import {
  DailyTaskPanel,
  PlannerFullscreen,
  WeekTimeGrid,
  plannerBlockViews,
  plannerDayTasks,
  type PlannerBlockView,
  type PlannerDayTaskView,
} from '@/components/planner';
import { usePlannerStore } from '@/lib/planner/store';
import type { PlannerPlan } from '@/lib/planner/types';
import {
  addLocalDays,
  isLocalDate,
  localDateFromDateCarrier,
  localDateFromIso,
  localDateToDateCarrier,
} from '@/lib/schedule/selectors';
import type { LocalDate } from '@/lib/schedule/types';
import { useAppStore } from '@/lib/store';

const PLAN_DAYS = 7;

function planStartDateKey(plan: PlannerPlan): LocalDate {
  const date = localDateFromIso(plan.horizonStart, plan.settings.timeZone);
  if (date) return date;
  const fallback = plan.horizonStart.slice(0, 10);
  return isLocalDate(fallback) ? fallback : '1970-01-01';
}

function planEndDateKey(plan: PlannerPlan): LocalDate {
  const end = new Date(plan.horizonEnd).getTime();
  if (Number.isFinite(end)) {
    const date = localDateFromIso(new Date(end - 1).toISOString(), plan.settings.timeZone);
    if (date) return date;
  }
  return addLocalDays(planStartDateKey(plan), PLAN_DAYS - 1);
}

function dateCarrier(date: LocalDate): Date {
  return localDateToDateCarrier(date) || new Date(1970, 0, 1, 12);
}

function civilDayDifference(date: LocalDate, start: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(startYear, startMonth - 1, startDay))
      / 86_400_000,
  );
}

function planDateRange(plan: PlannerPlan): string {
  const start = dateCarrier(planStartDateKey(plan));
  const end = dateCarrier(planEndDateKey(plan));

  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, 'MMM d')}–${format(end, 'd, yyyy')}`;
    }
    return `${format(start, 'MMM d')}–${format(end, 'MMM d, yyyy')}`;
  }
  return `${format(start, 'MMM d, yyyy')}–${format(end, 'MMM d, yyyy')}`;
}

function scheduledTimeLabel(minutes: number): string {
  const rounded = Math.round((minutes / 60) * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'hr' : 'hrs'}`;
}

function preferredDateForPlan(plan: PlannerPlan, now = new Date()): LocalDate {
  const start = planStartDateKey(plan);
  const end = planEndDateKey(plan);
  const today = localDateFromIso(now.toISOString(), plan.settings.timeZone);
  return today && today >= start && today <= end
    ? today
    : start;
}

export function PlannedCalendar() {
  const { user, subjects, tasks } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const userId = user?.id || null;
  const record = userId ? plannerUsers[userId] : null;
  const activePlan = record?.currentPlan || null;
  const initialTimeZone = activePlan?.settings.timeZone
    || record?.settings.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const [selectedDateKey, setSelectedDateKey] = useState<LocalDate>(() => (
    localDateFromIso(new Date().toISOString(), initialTimeZone) || '1970-01-01'
  ));
  const [fullscreen, setFullscreen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setActiveUser(
      userId,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
  }, [setActiveUser, userId]);

  const selectedPlan = activePlan;

  useEffect(() => {
    if (!selectedPlan) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedDateKey(preferredDateForPlan(selectedPlan));
      setDetailTaskId(null);
    });
    return () => { cancelled = true; };
  }, [selectedPlan]);

  const planStartKey = selectedPlan ? planStartDateKey(selectedPlan) : null;
  const selectedDate = dateCarrier(selectedDateKey);
  const planStartDate = planStartKey ? dateCarrier(planStartKey) : null;
  const selectedDayIndex = planStartKey
    ? civilDayDifference(selectedDateKey, planStartKey)
    : 0;
  const blocks = useMemo(
    () => plannerBlockViews(selectedPlan, subjects, tasks),
    [selectedPlan, subjects, tasks],
  );
  const dayTasks = useMemo(
    () => plannerDayTasks(selectedPlan, selectedDateKey, tasks, subjects),
    [selectedDateKey, selectedPlan, subjects, tasks],
  );
  const realTasksById = useMemo(
    () => new Map(tasks.map(task => [task.id, task])),
    [tasks],
  );
  const taskIdByBlockId = useMemo(
    () => new Map(
      (selectedPlan?.blocks || [])
        .filter(block => Boolean(block.taskId))
        .map(block => [block.id, block.taskId as string]),
    ),
    [selectedPlan],
  );
  const detailTask = detailTaskId ? realTasksById.get(detailTaskId) || null : null;

  const moveSelectedDay = (amount: number) => {
    if (!planStartKey) return;
    const nextIndex = Math.min(PLAN_DAYS - 1, Math.max(0, selectedDayIndex + amount));
    setSelectedDateKey(addLocalDays(planStartKey, nextIndex));
  };

  const selectDateCarrier = (next: Date) => {
    const date = localDateFromDateCarrier(next);
    if (date) setSelectedDateKey(date);
  };

  const isRealTask = (view: PlannerDayTaskView): boolean => {
    const taskId = taskIdByBlockId.get(view.id);
    return Boolean(taskId && realTasksById.has(taskId));
  };

  const openDayTask = (view: PlannerDayTaskView) => {
    const taskId = taskIdByBlockId.get(view.id);
    if (taskId && realTasksById.has(taskId)) setDetailTaskId(taskId);
  };

  const handleBlockClick = (view: PlannerBlockView) => {
    if (!selectedPlan) return;
    const start = view.startAt instanceof Date ? view.startAt.toISOString() : view.startAt;
    const date = localDateFromIso(start, selectedPlan.settings.timeZone);
    if (date) setSelectedDateKey(date);
    if (view.taskId && realTasksById.has(view.taskId)) setDetailTaskId(view.taskId);
  };

  if (!selectedPlan) {
    return (
      <Card className="overflow-hidden border-indigo-500/15 bg-gradient-to-br from-card/80 via-card/60 to-indigo-500/[0.06]">
        <CardContent className="flex min-h-[calc(100dvh-15rem)] flex-col items-center justify-center px-6 py-14 text-center">
          <div className="mb-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 shadow-lg shadow-indigo-500/20">
            <CalendarClock className="h-7 w-7 text-white" />
          </div>
          <h2 className="font-display text-xl font-semibold">No planned week yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Ask Orderly to plan your week first. Your active week will appear
            here automatically.
          </p>
          <Button asChild className="mt-6 bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
            <Link href="/planner">
              <Sparkles className="h-4 w-4" />
              Plan my week
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/45 bg-card/55 px-2.5 py-2 shadow-sm backdrop-blur-sm sm:px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={selectedDayIndex <= 0}
            onClick={() => moveSelectedDay(-1)}
            aria-label="Previous planned day"
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 px-1">
            <p className="truncate text-xs font-semibold sm:text-sm">{format(selectedDate, 'EEEE, MMM d')}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              Day {Math.min(PLAN_DAYS, Math.max(1, selectedDayIndex + 1))} of {PLAN_DAYS}
              {' · '}{planDateRange(selectedPlan)} · View only
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={selectedDayIndex >= PLAN_DAYS - 1}
            onClick={() => moveSelectedDay(1)}
            aria-label="Next planned day"
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge
            variant="outline"
            className="h-6 gap-1 border-indigo-500/25 bg-indigo-500/10 text-[9px] text-indigo-400 sm:text-[10px]"
          >
            <Sparkles className="h-2.5 w-2.5" />
            {selectedPlan.status === 'stale' ? 'Needs update' : 'Current'}
          </Badge>
          <Badge variant="outline" className="hidden h-6 gap-1 text-[10px] sm:inline-flex">
            <Clock3 className="h-2.5 w-2.5" />
            {scheduledTimeLabel(selectedPlan.totalScheduledMinutes)}
          </Badge>
          {selectedPlan.warnings.length > 0 && (
            <Badge
              variant="outline"
              className="h-6 gap-1 border-amber-500/25 bg-amber-500/10 text-[10px] text-amber-500"
              title={selectedPlan.warnings.map(warning => warning.message).join('\n')}
            >
              <CircleAlert className="h-2.5 w-2.5" />
              {selectedPlan.warnings.length}
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            onClick={() => setFullscreen(true)}
            aria-label="Open planned calendar full screen"
            title="Open full screen"
          >
            <Expand className="h-4 w-4" />
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 px-2.5 text-xs">
            <Link href="/planner">
              <PencilLine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit in Planner</span>
              <span className="sm:hidden">Edit</span>
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:h-[calc(100dvh-13.5rem)] xl:min-h-[620px] xl:grid-cols-[minmax(290px,350px)_minmax(0,1fr)]">
        <div className="h-[520px] min-w-0 xl:h-full">
          <DailyTaskPanel
            planStart={planStartDate || selectedDate}
            selectedDate={selectedDate}
            tasks={dayTasks}
            timeZone={selectedPlan.settings.timeZone}
            fillHeight
            readOnly
            showCompletionControl={false}
            onSelectedDateChange={selectDateCarrier}
            onTaskClick={openDayTask}
            isTaskClickable={isRealTask}
          />
        </div>

        <Card className="h-[650px] min-w-0 overflow-hidden border-indigo-500/15 xl:h-full">
          <CardContent className="h-full p-2 sm:p-3">
            <WeekTimeGrid
              weekStart={planStartDate || selectedDate}
              blocks={blocks}
              editable={false}
              selectedDate={selectedDate}
              onSelectedDateChange={selectDateCarrier}
              onBlockClick={handleBlockClick}
              showSummaryHeader={false}
              viewportClassName="h-full"
              timeZone={selectedPlan.settings.timeZone}
              timeZoneLabel={selectedPlan.settings.timeZone}
              className="h-full"
            />
          </CardContent>
        </Card>
      </div>

      <PlannerFullscreen
        open={fullscreen}
        onOpenChange={setFullscreen}
        weekStart={planStartDate || selectedDate}
        blocks={blocks}
        editable={false}
        selectedDate={selectedDate}
        onSelectedDateChange={selectDateCarrier}
        onBlockClick={handleBlockClick}
        timeZone={selectedPlan.settings.timeZone}
        timeZoneLabel={selectedPlan.settings.timeZone}
      />

      <TaskDetailViewer
        task={detailTask}
        open={Boolean(detailTask)}
        onOpenChange={open => !open && setDetailTaskId(null)}
      />
    </div>
  );
}
