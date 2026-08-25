'use client';

import { format, isSameDay } from 'date-fns';
import { ListTodo } from 'lucide-react';
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

export function UntimedTaskShelf({
  days,
  columns,
  items,
  selectedDate,
  onItemClick,
}: UntimedTaskShelfProps) {
  return (
    <div
      className="grid min-h-12 border-b border-border/70 bg-card/95"
      style={{ gridTemplateColumns: columns }}
      aria-label="Untimed tasks"
    >
      <div className="sticky left-0 z-50 flex items-center justify-center gap-1 border-r border-border/60 bg-card/95 px-1 text-[9px] font-medium text-muted-foreground">
        <ListTodo className="h-3 w-3" />
        <span className="hidden sm:inline">Untimed</span>
      </div>

      {days.map(day => {
        const date = format(day, 'yyyy-MM-dd');
        const dayItems = items.filter(item => item.date === date);
        return (
          <div
            key={date}
            className={cn(
              'max-h-24 min-h-12 space-y-1 overflow-y-auto border-r border-border/50 p-1 last:border-r-0',
              selectedDate && isSameDay(day, selectedDate) && 'bg-indigo-500/[0.05]',
            )}
          >
            {dayItems.map(item => {
              const duration = durationLabel(item.durationSeconds);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onItemClick?.(item)}
                  disabled={!onItemClick}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[10px] shadow-sm transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default',
                    item.completed && 'opacity-50',
                  )}
                  style={{
                    borderColor: colorBorder(item.color),
                    backgroundColor: colorBackground(item.color),
                  }}
                  aria-label={`${item.title}${duration ? `, ${duration}` : ''}, untimed`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color || '#6366f1' }} />
                  <span className={cn('min-w-0 flex-1 truncate font-medium', item.completed && 'line-through')}>
                    {item.title}
                  </span>
                  {duration && <span className="shrink-0 text-[8px] text-muted-foreground">{duration}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
