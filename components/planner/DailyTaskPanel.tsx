'use client';

import { useMemo } from 'react';
import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isSameDay,
  startOfDay,
} from 'date-fns';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { localDateFromDateCarrier, localDateFromIso } from '@/lib/schedule/selectors';
import { cn } from '@/lib/utils';
import type { PlannerDayTaskView } from './types';

const PLAN_DAYS = 7;

export interface DailyTaskPanelProps {
  planStart: string | Date;
  selectedDate: string | Date;
  tasks: PlannerDayTaskView[];
  className?: string;
  loading?: boolean;
  timeZone?: string;
  /** Lets the panel use the height supplied by a parent workspace. */
  fillHeight?: boolean;
  readOnly?: boolean;
  /** Hide completion controls in read-only consumers such as Calendar. */
  showCompletionControl?: boolean;
  onSelectedDateChange: (date: Date) => void;
  onTaskClick?: (task: PlannerDayTaskView) => void;
  /** Prevent rows without a real backing task from looking interactive. */
  isTaskClickable?: (task: PlannerDayTaskView) => boolean;
  onTaskToggle?: (task: PlannerDayTaskView) => void | Promise<void>;
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function plainText(value?: string | null): string {
  if (!value) return '';
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/li>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceLabel(source?: string | null): string | null {
  if (!source || source === 'manual') return null;
  if (source.toLowerCase() === 'canvas') return 'Canvas';
  if (source.toLowerCase().includes('google')) return 'Imported LMS';
  return source.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function durationLabel(start: Date, end: Date): string {
  const minutes = Math.max(0, differenceInMinutes(end, start));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function DailyTaskPanel({
  planStart,
  selectedDate,
  tasks,
  className,
  loading = false,
  timeZone,
  fillHeight = false,
  readOnly = false,
  showCompletionControl = true,
  onSelectedDateChange,
  onTaskClick,
  isTaskClickable,
  onTaskToggle,
}: DailyTaskPanelProps) {
  const firstDay = useMemo(() => startOfDay(asDate(planStart)), [planStart]);
  const currentDay = useMemo(() => startOfDay(asDate(selectedDate)), [selectedDate]);
  const currentDateKey = localDateFromDateCarrier(currentDay);
  const dayIndex = differenceInCalendarDays(currentDay, firstDay);
  const canGoPrevious = dayIndex > 0;
  const canGoNext = dayIndex < PLAN_DAYS - 1;

  const sortedTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) => {
          if (!timeZone || !currentDateKey) return isSameDay(asDate(task.startAt), currentDay);
          return localDateFromIso(asDate(task.startAt).toISOString(), timeZone) === currentDateKey;
        })
        .sort((a, b) => asDate(a.startAt).getTime() - asDate(b.startAt).getTime()),
    [currentDateKey, currentDay, tasks, timeZone],
  );

  const moveDay = (amount: number) => {
    const nextIndex = Math.min(PLAN_DAYS - 1, Math.max(0, dayIndex + amount));
    onSelectedDateChange(addDays(firstDay, nextIndex));
  };

  return (
    <Card
      className={cn(
        'flex flex-col overflow-hidden border-border/50',
        fillHeight ? 'h-full min-h-0' : 'min-h-[638px]',
        className,
      )}
    >
      <CardHeader className="border-b border-border/40 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 p-1.5 shadow-sm">
              <CalendarDays className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate font-display text-base">
                {format(currentDay, 'EEEE, MMM d')}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Day {Math.min(PLAN_DAYS, Math.max(1, dayIndex + 1))} of {PLAN_DAYS} · {sortedTasks.length} planned
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              disabled={!canGoPrevious}
              onClick={() => moveDay(-1)}
              aria-label="Previous planned day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              disabled={!canGoNext}
              onClick={() => moveDay(1)}
              aria-label="Next planned day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1" aria-label="Planned days">
          {Array.from({ length: PLAN_DAYS }, (_, index) => {
            const day = addDays(firstDay, index);
            const selected = isSameDay(day, currentDay);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => onSelectedDateChange(day)}
                className={cn(
                  'flex min-h-9 flex-col items-center justify-center rounded-lg text-[9px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
                  selected && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
                )}
                aria-pressed={selected}
              >
                <span>{format(day, 'EEE').slice(0, 1)}</span>
                <span className="text-[11px] font-semibold">{format(day, 'd')}</span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className={cn('p-0', fillHeight && 'min-h-0 flex-1')}>
        <div
          className={cn(
            'scroll-touch space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4',
            fillHeight ? 'h-full max-h-none' : 'max-h-[536px]',
          )}
        >
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl border border-border/40 bg-muted/30" />
            ))
          ) : sortedTasks.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-5 text-center">
              <div className="mb-3 rounded-2xl border border-indigo-500/15 bg-indigo-500/10 p-3">
                <Sparkles className="h-6 w-6 text-indigo-400" />
              </div>
              <p className="text-sm font-semibold">No work planned for this day</p>
              <p className="mt-1 max-w-56 text-xs leading-relaxed text-muted-foreground">
                {readOnly
                  ? 'Open Planner to add or move work into this day.'
                  : 'Ask Orderly to adjust the week, or drag a task into this day on the calendar.'}
              </p>
            </div>
          ) : (
            sortedTasks.map((task) => {
              const start = asDate(task.startAt);
              const end = asDate(task.endAt);
              const source = sourceLabel(task.source);
              const description = plainText(task.description);
              const color = task.subjectColor || '#6366f1';
              const due = task.dueAt ? asDate(task.dueAt) : null;
              const clickable = Boolean(
                onTaskClick && (isTaskClickable ? isTaskClickable(task) : true),
              );
              const toggleable = Boolean(!readOnly && showCompletionControl && onTaskToggle);

              return (
                <div
                  key={task.id}
                  onClick={clickable ? () => onTaskClick?.(task) : undefined}
                  className={cn(
                    'group rounded-xl border border-border/50 bg-card/55 p-3 text-left transition-all',
                    clickable && 'cursor-pointer hover:border-primary/20 hover:bg-accent/35 hover:shadow-sm',
                    task.completed && 'opacity-60',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {toggleable && (
                      <button
                        type="button"
                        data-size="icon-sm"
                        className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-emerald-500"
                        onClick={(event) => {
                          event.stopPropagation();
                          void Promise.resolve(onTaskToggle?.(task));
                        }}
                        aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                      >
                        {task.completed ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        {clickable ? (
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); onTaskClick?.(task); }}
                            className="min-w-0 text-left focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <span className={cn('line-clamp-2 text-xs font-semibold leading-snug', task.completed && 'line-through')}>
                              {task.title}
                            </span>
                          </button>
                        ) : (
                          <span className={cn('line-clamp-2 text-xs font-semibold leading-snug', task.completed && 'line-through')}>
                            {task.title}
                          </span>
                        )}
                        {source && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            <ExternalLink className="h-2.5 w-2.5" />
                            {source}
                          </span>
                        )}
                      </div>

                      {description && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/85">
                          {description}
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/30 pt-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <Clock3 className="h-2.5 w-2.5" />
                          {format(start, 'h:mm a')}–{format(end, 'h:mm a')}
                        </span>
                        <span className="rounded-md bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {durationLabel(start, end)}
                        </span>
                        {due && !Number.isNaN(due.getTime()) && (
                          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                            Due {format(due, isSameDay(due, currentDay) ? 'h:mm a' : 'EEE h:mm a')}
                          </span>
                        )}
                        {task.subjectName && (
                          <span
                            className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: `${color}20`, color }}
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                            <span className="max-w-32 truncate">{task.subjectName}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
