'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { addMinutes, differenceInMinutes, format } from 'date-fns';
import {
  CalendarDays,
  Clock3,
  ExternalLink,
  LockKeyhole,
  Save,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { PlannerBlockView } from './types';

const QUICK_DURATIONS = [15, 30, 45, 60, 75, 90];

export interface PlanBlockEditorProps {
  block: PlannerBlockView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    block: PlannerBlockView,
    nextStart: Date,
    nextEnd: Date,
  ) => void | Promise<void>;
  onRemove?: (block: PlannerBlockView) => void | Promise<void>;
  onViewTask?: (block: PlannerBlockView) => void;
  readOnly?: boolean;
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function isFixed(block: PlannerBlockView): boolean {
  return Boolean(
    block.fixed ||
      block.locked ||
      block.kind === 'school',
  );
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function plainText(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, ' ')
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

export function PlanBlockEditor({
  block,
  open,
  onOpenChange,
  onSave,
  onRemove,
  onViewTask,
  readOnly = false,
}: PlanBlockEditorProps) {
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const fixed = block ? isFixed(block) : false;
  const editingDisabled = readOnly || fixed;

  useEffect(() => {
    if (!block || !open) return;
    const start = asDate(block.startAt);
    const end = asDate(block.endAt);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDate(format(start, 'yyyy-MM-dd'));
      setStartTime(format(start, 'HH:mm'));
      setEndTime(format(end, 'HH:mm'));
      setError(null);
    });
    return () => { cancelled = true; };
  }, [block, open]);

  const draftTimes = useMemo(() => {
    if (!date || !startTime || !endTime) return null;
    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { start, end, minutes: differenceInMinutes(end, start) };
  }, [date, endTime, startTime]);

  const setDuration = (minutes: number) => {
    if (!date || !startTime) return;
    const start = new Date(`${date}T${startTime}:00`);
    if (Number.isNaN(start.getTime())) return;
    setEndTime(format(addMinutes(start, minutes), 'HH:mm'));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!block || editingDisabled) return;
    if (!draftTimes || draftTimes.minutes < 15) {
      setError('The block must be at least 15 minutes and end after it starts.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await Promise.resolve(onSave(block, draftTimes.start, draftTimes.end));
      onOpenChange(false);
    } catch {
      setError('Orderly could not update this block. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!block || !onRemove || editingDisabled) return;
    setRemoving(true);
    setError(null);
    try {
      await Promise.resolve(onRemove(block));
      onOpenChange(false);
    } catch {
      setError('Orderly could not remove this block. Please try again.');
    } finally {
      setRemoving(false);
    }
  };

  if (!block) return null;

  const color = block.subjectColor || block.color || '#6366f1';
  const originalStart = asDate(block.startAt);
  const originalEnd = asDate(block.endAt);
  const originalDuration = Math.max(0, differenceInMinutes(originalEnd, originalStart));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[460px]">
        <div className="border-b border-border/40 bg-gradient-to-b from-indigo-500/8 to-transparent px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <DialogHeader className="pr-7">
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 rounded-xl border p-2"
                style={{ backgroundColor: `${color}18`, borderColor: `${color}38`, color }}
              >
                {fixed ? <LockKeyhole className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <DialogTitle className="line-clamp-2 text-base leading-snug">{block.title}</DialogTitle>
                <DialogDescription className="mt-1 text-xs">
                  {fixed ? 'This commitment is fixed and the planner works around it.' : 'Adjust when and how long you want to work.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <form onSubmit={(event) => void submit(event)} className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="flex flex-wrap items-center gap-1.5 pt-4">
            {block.subjectName && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium"
                style={{ backgroundColor: `${color}20`, color }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                {block.subjectName}
              </span>
            )}
            <span className="rounded-md border border-border/50 px-2 py-1 text-[10px] capitalize text-muted-foreground">
              {block.kind || 'task'}
            </span>
            {block.source && (
              <span className="rounded-md border border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
                {block.source}
              </span>
            )}
            <span className="rounded-md bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
              {durationLabel(originalDuration)}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="planner-block-date" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="h-3 w-3" /> Date
            </Label>
            <Input
              id="planner-block-date"
              type="date"
              value={date}
              onChange={(event) => { setDate(event.target.value); setError(null); }}
              disabled={editingDisabled}
              className="h-9 bg-muted/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="planner-block-start" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Starts
              </Label>
              <Input
                id="planner-block-start"
                type="time"
                step={900}
                value={startTime}
                onChange={(event) => { setStartTime(event.target.value); setError(null); }}
                disabled={editingDisabled}
                className="h-9 bg-muted/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planner-block-end" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ends
              </Label>
              <Input
                id="planner-block-end"
                type="time"
                step={900}
                value={endTime}
                onChange={(event) => { setEndTime(event.target.value); setError(null); }}
                disabled={editingDisabled}
                className="h-9 bg-muted/30"
              />
            </div>
          </div>

          {!editingDisabled && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick duration</Label>
              <div className="grid grid-cols-6 gap-1">
                {QUICK_DURATIONS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setDuration(minutes)}
                    className={cn(
                      'rounded-md border border-border/50 bg-muted/30 px-1 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/10 hover:text-foreground',
                      draftTimes?.minutes === minutes && 'border-primary/40 bg-primary/10 text-primary',
                    )}
                  >
                    {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {block.description && (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
              <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{plainText(block.description)}</p>
              {onViewTask && block.taskId && (
                <button
                  type="button"
                  onClick={() => onViewTask(block)}
                  className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                >
                  View assignment details <ExternalLink className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <DialogFooter className="flex-row items-center border-t border-border/40 pt-4">
            {!editingDisabled && onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removing || saving}
                onClick={() => void remove()}
                className="mr-auto gap-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {editingDisabled ? 'Close' : 'Cancel'}
            </Button>
            {!editingDisabled && (
              <Button type="submit" size="sm" disabled={saving || removing} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save time'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
