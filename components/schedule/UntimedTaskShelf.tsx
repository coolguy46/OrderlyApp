'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { format, isSameDay } from 'date-fns';
import { GripVertical, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UntimedScheduleItem {
  id: string;
  taskId?: string | null;
  title: string;
  date: string;
  durationSeconds?: number | null;
  color?: string | null;
  completed?: boolean;
}

export interface UntimedTaskShelfProps {
  days: Date[];
  columns: string;
  items: UntimedScheduleItem[];
  selectedDate?: Date | null;
  onItemClick?: (item: UntimedScheduleItem) => void;
  draggable?: boolean;
  acceptsScheduledDrops?: boolean;
}

function durationLabel(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function colorBackground(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? `${color}20` : 'rgba(99, 102, 241, 0.12)';
}

function colorBorder(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? `${color}66` : 'rgba(99, 102, 241, 0.35)';
}

function UntimedTask({
  item,
  draggable,
  onClick,
}: {
  item: UntimedScheduleItem;
  draggable: boolean;
  onClick?: (item: UntimedScheduleItem) => void;
}) {
  const duration = durationLabel(item.durationSeconds);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'untimed-task', item },
    disabled: !draggable,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onClick?.(item);
      }}
      disabled={!onClick && !draggable}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[10px] shadow-sm transition-[filter,opacity] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default',
        draggable && 'cursor-grab touch-none active:cursor-grabbing',
        item.completed && 'opacity-50',
        isDragging && 'opacity-20',
      )}
      style={{
        borderColor: colorBorder(item.color),
        backgroundColor: colorBackground(item.color),
        transform: CSS.Translate.toString(transform),
      }}
      aria-label={`${item.title}${duration ? `, ${duration}` : ''}, untimed${draggable ? ', drag to schedule' : ''}`}
    >
      {draggable && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/70" />}
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color || '#6366f1' }} />
      <span className={cn('min-w-0 flex-1 truncate font-medium', item.completed && 'line-through')}>
        {item.title}
      </span>
      {duration && <span className="shrink-0 text-[8px] text-muted-foreground">{duration}</span>}
    </button>
  );
}

function UntimedDay({
  day,
  items,
  selected,
  draggable,
  acceptsScheduledDrops,
  onItemClick,
}: {
  day: Date;
  items: UntimedScheduleItem[];
  selected: boolean;
  draggable: boolean;
  acceptsScheduledDrops: boolean;
  onItemClick?: (item: UntimedScheduleItem) => void;
}) {
  const date = format(day, 'yyyy-MM-dd');
  const dayItems = items.filter(item => item.date === date);
  const { isOver, setNodeRef } = useDroppable({
    id: `planner-untimed:${date}`,
    data: { type: 'untimed-day', date },
    disabled: !acceptsScheduledDrops,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'max-h-24 min-h-12 space-y-1 overflow-y-auto border-r border-border/50 p-1 transition-colors last:border-r-0',
        selected && 'bg-indigo-500/[0.05]',
        isOver && 'bg-primary/15 ring-1 ring-inset ring-primary/50',
      )}
      aria-label={`Untimed tasks for ${format(day, 'EEEE, MMMM d')}`}
    >
      {dayItems.map(item => (
        <UntimedTask
          key={item.id}
          item={item}
          draggable={draggable && !item.completed}
          onClick={onItemClick}
        />
      ))}
    </div>
  );
}

export function UntimedTaskShelf({
  days,
  columns,
  items,
  selectedDate,
  onItemClick,
  draggable = false,
  acceptsScheduledDrops = false,
}: UntimedTaskShelfProps) {
  const { isOver: isShelfOver, setNodeRef: setShelfNodeRef } = useDroppable({
    id: 'planner-untimed-shelf',
    data: { type: 'untimed-shelf' },
    disabled: !acceptsScheduledDrops,
  });

  return (
    <div
      ref={setShelfNodeRef}
      className={cn(
        'grid min-h-12 border-b border-border/70 bg-card/95 transition-colors',
        isShelfOver && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
      )}
      style={{ gridTemplateColumns: columns }}
      aria-label="Untimed tasks"
    >
      <div className={cn(
        'sticky left-0 z-50 flex items-center justify-center gap-1 border-r border-border/60 bg-card/95 px-1 text-[9px] font-medium text-muted-foreground transition-colors',
        isShelfOver && 'bg-primary/15 text-primary',
      )}>
        <ListTodo className="h-3 w-3" />
        <span className="hidden sm:inline">Untimed</span>
      </div>

      {days.map(day => (
        <UntimedDay
          key={format(day, 'yyyy-MM-dd')}
          day={day}
          items={items}
          selected={Boolean(selectedDate && isSameDay(day, selectedDate))}
          draggable={draggable}
          acceptsScheduledDrops={acceptsScheduledDrops}
          onItemClick={onItemClick}
        />
      ))}
    </div>
  );
}
