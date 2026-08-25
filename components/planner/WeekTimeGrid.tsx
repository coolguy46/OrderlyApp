'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  startOfDay,
} from 'date-fns';
import { Clock3, Expand, GripVertical, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { PlannerBlockView } from './types';

const DAYS_IN_PLAN = 7;
const MINUTES_PER_DAY = 24 * 60;
const SNAP_MINUTES = 15;
const PIXELS_PER_MINUTE = 1;
const HOUR_HEIGHT = 60 * PIXELS_PER_MINUTE;
const GRID_HEIGHT = MINUTES_PER_DAY * PIXELS_PER_MINUTE;

export interface WeekTimeGridProps {
  weekStart: string | Date;
  blocks: PlannerBlockView[];
  editable?: boolean;
  variant?: 'preview' | 'fullscreen';
  className?: string;
  /** Overrides the default 600px preview viewport for embedded workspaces. */
  viewportClassName?: string;
  showSummaryHeader?: boolean;
  timeZoneLabel?: string;
  initialScrollHour?: number;
  selectedDate?: string | Date;
  onSelectedDateChange?: (date: Date) => void;
  onBlockMove?: (
    block: PlannerBlockView,
    nextStart: Date,
    nextEnd: Date,
  ) => void | Promise<void>;
  onBlockResize?: (
    block: PlannerBlockView,
    nextStart: Date,
    nextEnd: Date,
  ) => void | Promise<void>;
  onBlockClick?: (block: PlannerBlockView) => void;
  onRequestFullscreen?: () => void;
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapMinutes(value: number): number {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

function minutesIntoDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function blockColor(block: PlannerBlockView): string {
  return block.subjectColor || block.color || '#6366f1';
}

function colorWithAlpha(color: string, alpha: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : fallback;
}

function isFixedBlock(block: PlannerBlockView): boolean {
  return Boolean(
    block.fixed ||
      block.locked ||
      block.kind === 'commitment' ||
      block.kind === 'school',
  );
}

function formatBlockTime(start: Date, end: Date): string {
  return `${format(start, 'h:mm a')}–${format(end, 'h:mm a')}`;
}

interface PositionedBlockProps {
  block: PlannerBlockView;
  start: Date;
  end: Date;
  editable: boolean;
  active?: boolean;
  suppressClickUntil: MutableRefObject<number>;
  onClick?: (block: PlannerBlockView) => void;
  onResizeStart?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    block: PlannerBlockView,
  ) => void;
}

function PositionedBlock({
  block,
  start,
  end,
  editable,
  active,
  suppressClickUntil,
  onClick,
  onResizeStart,
}: PositionedBlockProps) {
  const fixed = isFixedBlock(block);
  const draggable = editable && !fixed;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    disabled: !draggable,
  });

  const startMinute = clamp(minutesIntoDay(start), 0, MINUTES_PER_DAY - SNAP_MINUTES);
  const rawDuration = Math.max(SNAP_MINUTES, differenceInMinutes(end, start));
  const duration = Math.min(rawDuration, MINUTES_PER_DAY - startMinute);
  const color = blockColor(block);
  const height = Math.max(SNAP_MINUTES * PIXELS_PER_MINUTE, duration * PIXELS_PER_MINUTE);
  const compact = height < 42;
  const roomy = height >= 66;

  const style: CSSProperties = {
    top: startMinute * PIXELS_PER_MINUTE,
    height,
    transform: CSS.Translate.toString(transform),
    borderColor: colorWithAlpha(color, '99', 'rgba(99, 102, 241, 0.55)'),
    borderLeftColor: color,
    backgroundColor: fixed
      ? colorWithAlpha(color, '14', 'rgba(113, 113, 122, 0.18)')
      : colorWithAlpha(color, '2b', 'rgba(99, 102, 241, 0.18)'),
    zIndex: isDragging || active ? 35 : 10,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${block.title}, ${formatBlockTime(start, end)}, ${minutesLabel(duration)}`}
      onClick={(event) => {
        event.stopPropagation();
        if (Date.now() >= suppressClickUntil.current && !isDragging) onClick?.(block);
      }}
      onKeyDown={(event) => {
        if (draggable) listeners?.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if ((event.key === 'Enter' || (!draggable && event.key === ' ')) && !isDragging) {
          event.preventDefault();
          onClick?.(block);
        }
      }}
      className={cn(
        'group absolute left-1 right-1 overflow-hidden rounded-md border border-l-[3px] px-1.5 py-1 text-left shadow-sm outline-none transition-[box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-primary',
        draggable && 'cursor-grab touch-none active:cursor-grabbing',
        fixed && 'border-dashed bg-muted/70',
        block.completed && 'opacity-55',
        isDragging && 'opacity-25',
        active && 'shadow-xl ring-1 ring-primary/50',
        compact && 'py-0.5',
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        {fixed ? (
          <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        ) : editable ? (
          <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-[11px] font-semibold leading-tight text-foreground',
              block.completed && 'line-through',
            )}
          >
            {block.title}
          </p>
          {!compact && (
            <p className="truncate text-[9px] leading-tight text-muted-foreground">
              {formatBlockTime(start, end)}
            </p>
          )}
          {roomy && (
            <p className="mt-0.5 truncate text-[9px] leading-tight text-muted-foreground/80">
              {block.subjectName || block.reason || minutesLabel(duration)}
            </p>
          )}
        </div>
      </div>

      {draggable && (
        <button
          type="button"
          aria-label={`Resize ${block.title}`}
          title="Drag to change duration"
          data-size="icon-sm"
          onPointerDown={(event) => onResizeStart?.(event, block)}
          className="absolute inset-x-1 bottom-0 z-20 h-2 cursor-ns-resize touch-none rounded-full opacity-0 transition-opacity after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-7 after:-translate-x-1/2 after:rounded-full after:bg-foreground/35 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
        />
      )}
    </div>
  );
}

function DayColumn({ day }: { day: Date }) {
  const { isOver, setNodeRef } = useDroppable({ id: `planner-day:${format(day, 'yyyy-MM-dd')}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative border-r border-border/50 bg-background/25 transition-colors last:border-r-0',
        isOver && 'bg-primary/5',
      )}
      style={{ height: GRID_HEIGHT }}
    >
      {Array.from({ length: 25 }, (_, hour) => (
        <div
          key={hour}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-border/45"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}
      {Array.from({ length: 24 * 3 }, (_, quarter) => (
        <div
          key={`quarter-${quarter}`}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-border/15"
          style={{ top: (quarter + 1) * SNAP_MINUTES * PIXELS_PER_MINUTE }}
        />
      ))}
    </div>
  );
}

export function WeekTimeGrid({
  weekStart,
  blocks,
  editable = false,
  variant = 'preview',
  className,
  viewportClassName,
  showSummaryHeader = true,
  timeZoneLabel,
  initialScrollHour = 6,
  selectedDate,
  onSelectedDateChange,
  onBlockMove,
  onBlockResize,
  onBlockClick,
  onRequestFullscreen,
}: WeekTimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{ blockId: string; end: Date } | null>(null);
  const [now, setNow] = useState(() => new Date());

  const normalizedWeekStart = useMemo(() => startOfDay(asDate(weekStart)), [weekStart]);
  const days = useMemo(
    () => Array.from({ length: DAYS_IN_PLAN }, (_, index) => addDays(normalizedWeekStart, index)),
    [normalizedWeekStart],
  );
  const selectedDay = useMemo(() => {
    if (!selectedDate) return null;
    const value = startOfDay(asDate(selectedDate));
    return isValidDate(value) ? value : null;
  }, [selectedDate]);

  const validBlocks = useMemo(
    () =>
      blocks.filter((block) => {
        const start = asDate(block.startAt);
        const end = asDate(block.endAt);
        return isValidDate(start) && isValidDate(end) && end > start;
      }),
    [blocks],
  );

  const activeBlock = useMemo(
    () => validBlocks.find((block) => block.id === activeBlockId) || null,
    [activeBlockId, validBlocks],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = clamp(initialScrollHour, 0, 23) * HOUR_HEIGHT;
  }, [initialScrollHour, variant]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const invokeMove = useCallback(
    (block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
      if (!onBlockMove) return;
      void Promise.resolve(onBlockMove(block, nextStart, nextEnd));
    },
    [onBlockMove],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveBlockId(String(event.active.id));
  }, []);

  const handleDragCancel = useCallback(() => setActiveBlockId(null), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const block = validBlocks.find((candidate) => candidate.id === String(event.active.id));
      setActiveBlockId(null);
      if (!block || !event.over || isFixedBlock(block)) return;

      const targetDateString = String(event.over.id).replace('planner-day:', '');
      const targetDayIndex = days.findIndex((day) => format(day, 'yyyy-MM-dd') === targetDateString);
      if (targetDayIndex < 0) return;

      const originalStart = asDate(block.startAt);
      const originalEnd = asDate(block.endAt);
      const duration = Math.max(SNAP_MINUTES, differenceInMinutes(originalEnd, originalStart));
      const movedMinutes = snapMinutes(event.delta.y / PIXELS_PER_MINUTE);
      const nextMinute = clamp(
        minutesIntoDay(originalStart) + movedMinutes,
        0,
        MINUTES_PER_DAY - duration,
      );
      const nextStart = addMinutes(startOfDay(days[targetDayIndex]), nextMinute);
      const nextEnd = addMinutes(nextStart, duration);
      const changed = nextStart.getTime() !== originalStart.getTime();

      if (changed) {
        suppressClickUntil.current = Date.now() + 250;
        invokeMove(block, nextStart, nextEnd);
      }
    },
    [days, invokeMove, validBlocks],
  );

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, block: PlannerBlockView) => {
      if (!editable || isFixedBlock(block)) return;
      event.preventDefault();
      event.stopPropagation();

      resizeCleanupRef.current?.();

      const originalStart = asDate(block.startAt);
      const originalEnd = asDate(block.endAt);
      const originalDuration = Math.max(SNAP_MINUTES, differenceInMinutes(originalEnd, originalStart));
      const maximumDuration = MINUTES_PER_DAY - minutesIntoDay(originalStart);
      const pointerStart = event.clientY;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaMinutes = snapMinutes((moveEvent.clientY - pointerStart) / PIXELS_PER_MINUTE);
        const duration = clamp(originalDuration + deltaMinutes, SNAP_MINUTES, maximumDuration);
        setResizePreview({ blockId: block.id, end: addMinutes(originalStart, duration) });
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        resizeCleanupRef.current = null;
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        const deltaMinutes = snapMinutes((upEvent.clientY - pointerStart) / PIXELS_PER_MINUTE);
        const duration = clamp(originalDuration + deltaMinutes, SNAP_MINUTES, maximumDuration);
        const nextEnd = addMinutes(originalStart, duration);
        cleanup();
        setResizePreview(null);
        suppressClickUntil.current = Date.now() + 250;
        if (nextEnd.getTime() !== originalEnd.getTime() && onBlockResize) {
          void Promise.resolve(onBlockResize(block, originalStart, nextEnd));
        }
      };

      const onPointerCancel = () => {
        cleanup();
        setResizePreview(null);
      };

      resizeCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      setResizePreview({ blockId: block.id, end: originalEnd });
    },
    [editable, onBlockResize],
  );

  const columns = variant === 'fullscreen'
    ? '64px repeat(7, minmax(0, 1fr))'
    : '64px repeat(7, minmax(132px, 1fr))';
  const contentMinWidth = variant === 'fullscreen' ? 'min-w-[980px] lg:min-w-0' : 'min-w-[990px]';

  return (
    <section className={cn('min-w-0', className)} aria-label="Planned week calendar">
      {showSummaryHeader && (
        <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {format(days[0], 'MMM d')}–{format(days[6], 'MMM d, yyyy')}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {editable ? 'Drag blocks to move them. Drag the bottom edge to resize.' : 'Read-only planned schedule'}
            </p>
          </div>
          {variant === 'preview' && onRequestFullscreen && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRequestFullscreen}
              aria-label="Open full-screen calendar"
              title="Open full-screen"
              className="h-8 w-8 shrink-0"
            >
              <Expand className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={scrollRef}
          className={cn(
            'scroll-touch relative overflow-auto overscroll-contain rounded-xl border border-border/60 bg-card/35',
            !viewportClassName && (variant === 'fullscreen' ? 'h-[calc(100dvh-8.5rem)]' : 'h-[600px]'),
            viewportClassName,
          )}
        >
          <div className={cn('relative', contentMinWidth)}>
            <div
              className="sticky top-0 z-40 grid h-14 border-b border-border/70 bg-card/95 shadow-sm backdrop-blur-xl"
              style={{ gridTemplateColumns: columns }}
            >
              <div className="sticky left-0 z-50 flex items-center justify-center border-r border-border/60 bg-card/95 px-1 text-[9px] font-medium text-muted-foreground">
                {timeZoneLabel || 'Local'}
              </div>
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className={cn(
                    'flex items-stretch justify-stretch border-r border-border/50 last:border-r-0',
                    isSameDay(day, now) && 'bg-primary/5',
                    selectedDay && isSameDay(day, selectedDay) && 'bg-indigo-500/10',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectedDateChange?.(startOfDay(day))}
                    disabled={!onSelectedDateChange}
                    aria-pressed={Boolean(selectedDay && isSameDay(day, selectedDay))}
                    className="flex w-full flex-col items-center justify-center px-2 disabled:cursor-default"
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {format(day, 'EEE')}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                        isSameDay(day, now) && 'bg-primary text-primary-foreground shadow-sm',
                        selectedDay && isSameDay(day, selectedDay) && !isSameDay(day, now) && 'bg-indigo-500 text-white shadow-sm',
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                  </button>
                </div>
              ))}
            </div>

            <div className="grid" style={{ gridTemplateColumns: columns }}>
              <div
                className="sticky left-0 z-30 border-r border-border/60 bg-card/95"
                style={{ height: GRID_HEIGHT }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 -translate-y-1/2 pr-2 text-right text-[9px] text-muted-foreground"
                    style={{ top: hour * HOUR_HEIGHT }}
                  >
                    {format(addMinutes(startOfDay(new Date()), hour * 60), 'h a')}
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const dayBlocks = validBlocks.filter((block) => isSameDay(asDate(block.startAt), day));
                const today = isSameDay(day, now);
                const currentMinute = minutesIntoDay(now);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'relative',
                      selectedDay && isSameDay(day, selectedDay) && 'bg-indigo-500/[0.025]',
                    )}
                    style={{ height: GRID_HEIGHT }}
                  >
                    <DayColumn day={day} />

                    {today && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 z-20 border-t border-red-400/80"
                        style={{ top: currentMinute * PIXELS_PER_MINUTE }}
                      >
                        <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-400" />
                      </div>
                    )}

                    {dayBlocks.map((block) => {
                      const start = asDate(block.startAt);
                      const end = resizePreview?.blockId === block.id
                        ? resizePreview.end
                        : asDate(block.endAt);
                      return (
                        <PositionedBlock
                          key={block.id}
                          block={block}
                          start={start}
                          end={end}
                          editable={editable}
                          active={activeBlockId === block.id}
                          suppressClickUntil={suppressClickUntil}
                          onClick={onBlockClick}
                          onResizeStart={handleResizeStart}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeBlock ? (
            <div
              className="w-36 rounded-md border border-primary/50 border-l-[3px] bg-card/95 px-2 py-1.5 shadow-2xl backdrop-blur-xl"
              style={{ borderLeftColor: blockColor(activeBlock) }}
            >
              <p className="truncate text-[11px] font-semibold">{activeBlock.title}</p>
              <p className="text-[9px] text-muted-foreground">
                <Clock3 className="mr-1 inline h-2.5 w-2.5" />
                {format(asDate(activeBlock.startAt), 'h:mm a')}
              </p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
