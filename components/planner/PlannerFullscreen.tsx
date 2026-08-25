'use client';

import { format } from 'date-fns';
import { CalendarRange, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { WeekTimeGrid, type WeekTimeGridProps } from './WeekTimeGrid';

export interface PlannerFullscreenProps
  extends Omit<WeekTimeGridProps, 'variant' | 'onRequestFullscreen'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function PlannerFullscreen({
  open,
  onOpenChange,
  weekStart,
  blocks,
  editable = false,
  ...gridProps
}: PlannerFullscreenProps) {
  const start = asDate(weekStart);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:inset-0 sm:h-dvh sm:w-screen sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-0"
        style={{
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100dvh',
          maxWidth: 'none',
          maxHeight: 'none',
          transform: 'none',
        }}
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border/50 bg-card/70 px-4 py-3 text-left backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2 shadow-md shadow-indigo-500/15">
              <CalendarRange className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-display">Planned week</DialogTitle>
              <DialogDescription className="truncate text-[11px]">
                Week of {format(start, 'MMMM d, yyyy')} · {editable ? 'Changes save automatically' : 'Read-only view'}
              </DialogDescription>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close full-screen planner"
            className="h-9 w-9 shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="min-h-0 flex-1 px-3 py-3 sm:px-5">
          <WeekTimeGrid
            {...gridProps}
            weekStart={weekStart}
            blocks={blocks}
            editable={editable}
            variant="fullscreen"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

