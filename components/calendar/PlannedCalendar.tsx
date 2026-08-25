'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  Archive,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  PencilLine,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  PlannerFullscreen,
  WeekTimeGrid,
  plannerBlockViews,
} from '@/components/planner';
import { usePlannerStore } from '@/lib/planner/store';
import type { PlannerPlan } from '@/lib/planner/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

function planTimestamp(plan: PlannerPlan): number {
  const horizon = new Date(plan.horizonStart).getTime();
  return Number.isFinite(horizon) ? horizon : new Date(plan.generatedAt).getTime();
}

function planDateRange(plan: PlannerPlan): string {
  const start = new Date(plan.horizonStart);
  const end = new Date(plan.horizonEnd);
  const visibleEnd = new Date(end.getTime() - 1);

  if (start.getFullYear() === visibleEnd.getFullYear()) {
    if (start.getMonth() === visibleEnd.getMonth()) {
      return `${format(start, 'MMM d')}–${format(visibleEnd, 'd, yyyy')}`;
    }
    return `${format(start, 'MMM d')}–${format(visibleEnd, 'MMM d, yyyy')}`;
  }
  return `${format(start, 'MMM d, yyyy')}–${format(visibleEnd, 'MMM d, yyyy')}`;
}

function scheduledTimeLabel(minutes: number): string {
  const rounded = Math.round((minutes / 60) * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'hr' : 'hrs'}`;
}

export function PlannedCalendar() {
  const { user, subjects, tasks } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const userId = user?.id || null;
  const record = userId ? plannerUsers[userId] : null;
  const activePlan = record?.currentPlan || null;
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setActiveUser(
      userId,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
  }, [setActiveUser, userId]);

  const plans = useMemo(() => {
    const unique = new Map<string, PlannerPlan>();
    record?.history.forEach(plan => unique.set(plan.id, plan));
    if (activePlan) unique.set(activePlan.id, activePlan);
    return [...unique.values()].sort((left, right) => {
      const difference = planTimestamp(left) - planTimestamp(right);
      return difference || left.generatedAt.localeCompare(right.generatedAt);
    });
  }, [activePlan, record?.history]);

  useEffect(() => {
    if (!plans.length) {
      setSelectedPlanId(null);
      return;
    }
    if (selectedPlanId && plans.some(plan => plan.id === selectedPlanId)) return;
    setSelectedPlanId(activePlan?.id || plans[plans.length - 1].id);
  }, [activePlan?.id, plans, selectedPlanId]);

  const selectedPlan = useMemo(
    () => plans.find(plan => plan.id === selectedPlanId)
      || activePlan
      || plans[plans.length - 1]
      || null,
    [activePlan, plans, selectedPlanId],
  );
  const selectedIndex = selectedPlan
    ? plans.findIndex(plan => plan.id === selectedPlan.id)
    : -1;
  const isActive = Boolean(
    selectedPlan && activePlan && selectedPlan.id === activePlan.id,
  );
  const blocks = useMemo(
    () => plannerBlockViews(selectedPlan, subjects, tasks),
    [selectedPlan, subjects, tasks],
  );

  const choosePlan = (index: number) => {
    const plan = plans[index];
    if (!plan) return;
    setSelectedPlanId(plan.id);
    setFullscreen(false);
  };

  if (!selectedPlan) {
    return (
      <Card className="overflow-hidden border-indigo-500/15 bg-gradient-to-br from-card/80 via-card/60 to-indigo-500/[0.06]">
        <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-14 text-center">
          <div className="mb-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 shadow-lg shadow-indigo-500/20">
            <CalendarClock className="h-7 w-7 text-white" />
          </div>
          <h2 className="font-display text-xl font-semibold">No planned week yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Ask Orderly to plan your week first. Your saved schedule will then
            appear here automatically, including older weeks you archive.
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
    <div className="space-y-4">
      <Card className="overflow-hidden border-indigo-500/15">
        <CardHeader className="gap-4 border-b border-border/40 bg-gradient-to-r from-indigo-500/[0.07] via-transparent to-purple-500/[0.06] sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <CardTitle className="font-display text-lg">Planned calendar</CardTitle>
              <Badge
                variant={isActive ? 'default' : 'outline'}
                className={cn(
                  isActive
                    ? 'border-transparent bg-indigo-500 text-white'
                    : 'border-border/60 bg-background/50 text-muted-foreground',
                )}
              >
                {isActive ? <Sparkles className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                {isActive
                  ? selectedPlan.status === 'stale' ? 'Needs update' : 'Active plan'
                  : 'Archived'}
              </Badge>
              {selectedPlan.warnings.length > 0 && (
                <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-500">
                  <CircleAlert className="h-3 w-3" />
                  {selectedPlan.warnings.length} warning{selectedPlan.warnings.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <CardDescription>
              {planDateRange(selectedPlan)} · {scheduledTimeLabel(selectedPlan.totalScheduledMinutes)} scheduled
              {' · '}Read-only here—make changes in Planner.
            </CardDescription>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {activePlan && !isActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPlanId(activePlan.id)}
              >
                Current week
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/planner">
                <PencilLine className="h-4 w-4" />
                Edit in Planner
              </Link>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={selectedIndex <= 0}
              onClick={() => choosePlan(selectedIndex - 1)}
              aria-label="Show previous planned week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-medium">{planDateRange(selectedPlan)}</p>
              <p className="text-[11px] text-muted-foreground">
                Plan {selectedIndex + 1} of {plans.length}
                {record?.history.length ? ` · ${record.history.length} archived` : ''}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={selectedIndex < 0 || selectedIndex >= plans.length - 1}
              onClick={() => choosePlan(selectedIndex + 1)}
              aria-label="Show next planned week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <WeekTimeGrid
            weekStart={selectedPlan.horizonStart}
            blocks={blocks}
            editable={false}
            timeZoneLabel={selectedPlan.settings.timeZone}
            onRequestFullscreen={() => setFullscreen(true)}
            className="rounded-none border-0"
          />
        </CardContent>
      </Card>

      <PlannerFullscreen
        open={fullscreen}
        onOpenChange={setFullscreen}
        weekStart={selectedPlan.horizonStart}
        blocks={blocks}
        editable={false}
        timeZoneLabel={selectedPlan.settings.timeZone}
      />
    </div>
  );
}
