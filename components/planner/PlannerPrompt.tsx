'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { format } from 'date-fns';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Send,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { PlannerChatMessage } from '@/lib/planner/types';

const DEFAULT_SUGGESTIONS = [
  'Plan my week',
  'Make Tuesday lighter',
  'Move math work earlier',
  'Keep my evenings free',
];

export interface PlannerPromptProps {
  messages?: PlannerChatMessage[];
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit: (prompt: string) => void | Promise<void>;
  suggestions?: string[];
  isSubmitting?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

function asDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function PlannerPrompt({
  messages = [],
  value,
  onValueChange,
  onSubmit,
  suggestions = DEFAULT_SUGGESTIONS,
  isSubmitting = false,
  disabled = false,
  className,
  placeholder = 'Tell Orderly how you want this week planned…',
}: PlannerPromptProps) {
  const [internalValue, setInternalValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const prompt = value ?? internalValue;

  const setPrompt = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = prompt.trim();
    if (!normalized || disabled || isSubmitting) return;
    try {
      await Promise.resolve(onSubmit(normalized));
      setPrompt('');
    } catch {
      // The owner is responsible for surfacing its request error. Keeping the
      // prompt intact lets the user retry without retyping their instructions.
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Card className={cn('overflow-hidden border-indigo-500/15 bg-gradient-to-br from-indigo-500/7 to-purple-500/5', className)}>
      <CardContent className="p-3.5 sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2 shadow-md shadow-indigo-500/15">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold font-display">Plan with Orderly</h3>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Ask for a fresh plan or describe exactly what you want changed.
              </p>
            </div>
          </div>

          {messages.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen((open) => !open)}
              className="h-8 shrink-0 gap-1.5 px-2 text-[11px] text-muted-foreground"
              aria-expanded={historyOpen}
            >
              <History className="h-3.5 w-3.5" />
              History
              {historyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
        </div>

        {historyOpen && messages.length > 0 && (
          <div className="scroll-touch mb-3 max-h-52 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-border/40 bg-background/45 p-2.5">
            {messages.map((message) => {
              const created = asDate(message.createdAt);
              const userMessage = message.role === 'user';
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-2.5 py-2',
                    userMessage ? 'ml-6 bg-primary/10' : 'mr-6 bg-muted/50',
                  )}
                >
                  <div className={cn('mt-0.5 rounded-full p-1', userMessage ? 'bg-primary/15' : 'bg-indigo-500/15')}>
                    {userMessage ? (
                      <UserRound className="h-3 w-3 text-primary" />
                    ) : (
                      <Bot className="h-3 w-3 text-indigo-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90">
                      {message.content}
                    </p>
                    {created && (
                      <p className="mt-0.5 text-[9px] text-muted-foreground/70">{format(created, 'MMM d, h:mm a')}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled || isSubmitting}
              onClick={() => setPrompt(suggestion)}
              className="rounded-full border border-border/50 bg-background/50 px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <form onSubmit={(event) => void submit(event)} className="relative">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isSubmitting}
            rows={3}
            className="min-h-[82px] resize-none border-border/60 bg-background/70 pb-10 pr-12 text-sm focus:bg-background"
            aria-label="Planner instructions"
          />
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
            <span className="truncate text-[9px] text-muted-foreground/70">Enter to send · Shift+Enter for a new line</span>
            <Button
              type="submit"
              size="icon-sm"
              disabled={!prompt.trim() || disabled || isSubmitting}
              className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm"
              aria-label="Send planner instructions"
            >
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </form>

        <div className="mt-2.5 grid gap-1 text-[9px] leading-relaxed text-muted-foreground/75 sm:grid-cols-2 sm:gap-3">
          <p>Works best with Canvas because assignment descriptions give Orderly more context.</p>
          <p>Suggested times are estimates, not guarantees—review and adjust the plan when needed.</p>
        </div>
      </CardContent>
    </Card>
  );
}
