'use client';

import { type ReactNode } from 'react';
import { CalendarCheck2, MessageSquareText, Sparkles, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/lib/store';
import { BillingDetails, subscriptionMessage } from './BillingDetails';
import { useBilling } from './useBilling';

/** Fictional decoration only, never a blurred copy of someone's private chat. */
function ChatBackdrop() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none overflow-hidden bg-[#080b14]">
    <div className="absolute inset-0 flex flex-col justify-between gap-8 p-6 opacity-45 blur-[5px] sm:p-9">
      <div className="flex items-center gap-3 border-b border-white/10 pb-5 text-sm text-slate-400"><Sparkles className="h-5 w-5 text-violet-300" /> Orderly AI</div>
      <div className="ml-auto max-w-[70%] rounded-2xl rounded-br-sm bg-violet-500/20 px-6 py-4 text-slate-300">Help me make room for what matters this week.</div>
      <div className="max-w-[70%] space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6"><div className="h-2 w-3/4 rounded bg-white/20" /><div className="h-2 w-full rounded bg-white/10" /><div className="h-2 w-1/2 rounded bg-violet-300/20" /></div>
      <div className="h-12 rounded-xl border border-white/15 bg-white/5" />
    </div>
    <div className="absolute inset-0 bg-black/60" />
  </div>;
}

function AccountGate({ userId, children, recoveryActions }: { userId: string; children: ReactNode; recoveryActions?: ReactNode }) {
  const billing = useBilling(userId);
  const { status, checking, busy, openBilling } = billing;
  if (status && (!status.subscriptionRequired || status.aiAccess === true)) return <>
    {status.enabled && status.subscriptionRequired && status.aiAccess && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-4 py-3">
      <p role="status" className="text-xs leading-relaxed text-muted-foreground">{subscriptionMessage(status)}</p>
      {status.canManage && <Button size="sm" variant="ghost" disabled={!!busy || checking} onClick={() => void openBilling('portal')}>{busy === 'portal' ? 'Opening Stripe…' : 'Manage subscription'}</Button>}
      {billing.error && <p role="alert" className="w-full text-sm text-destructive">{billing.error}</p>}
    </div>}
    {children}
  </>;

  return <section className="workspace-panel relative isolate overflow-hidden" aria-label="Orderly AI subscription">
    <ChatBackdrop />
    <div className="relative px-4 py-7 sm:px-7 sm:py-10">
      <div className="mx-auto grid max-w-4xl gap-7 rounded-2xl border border-white/15 bg-[#11131f]/95 p-5 text-slate-50 shadow-2xl sm:p-7 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:p-8">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs font-medium text-violet-200"><Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> Orderly AI</div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Less figuring it out.<br />More getting it done.</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-300">Talk through your day with a planner that works with your tasks and calendar.</p>
          <ul className="mt-5 space-y-3 text-sm text-slate-200">
            <li className="flex items-start gap-2.5"><MessageSquareText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><span>Add and update plans in your own words</span></li>
            <li className="flex items-start gap-2.5"><CalendarCheck2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><span>Find time around your existing schedule</span></li>
            <li className="flex items-start gap-2.5"><WandSparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><span>Turn overdue work into a manageable plan</span></li>
          </ul>
          <p className="mt-6 border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-300"><span className="font-medium text-white">Only AI is paid.</span> Your calendar, scheduler, tasks, and all other tools stay free.</p>
        </div>
        <div className="min-w-0 border-t border-white/10 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"><BillingDetails billing={billing} dark /></div>
      </div>
      {recoveryActions && <div className="mx-auto mt-4 flex max-w-4xl flex-wrap gap-2 rounded-xl bg-card text-card-foreground">{recoveryActions}</div>}
    </div>
  </section>;
}

export function AssistantSubscriptionGate(props: { children: ReactNode; recoveryActions?: ReactNode }) {
  const userId = useAppStore(state => state.user?.id);
  return userId ? <AccountGate key={userId} userId={userId} {...props} /> : null;
}
