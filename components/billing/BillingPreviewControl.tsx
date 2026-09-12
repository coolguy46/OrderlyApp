'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, FlaskConical, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAppStore } from '@/lib/store';
import { previewScenario, previewScenarios, type PreviewScenario } from '@/lib/billing/preview-scenarios';
import { AssistantAccessView } from './AssistantAccessView';
import { BillingDetails } from './BillingDetails';
import type { BillingView } from './useBilling';

/** No real chat, subscription hook, portal, or entitlement changes in this dialog. */
function PreviewScreens({ userId }: { userId: string }) {
  const [scenario, setScenario] = useState<PreviewScenario>('locked');
  const [now] = useState(() => Date.now());
  const [panel, setPanel] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [returned] = useState(() => new URLSearchParams(window.location.search).get('billingPreviewReturn') === '1');
  const [busy, setBusy] = useState<'checkout' | null>(null);
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => { action.current?.abort(); }, []);
  const sample = previewScenario(scenario, now);
  function choose(next: PreviewScenario) {
    action.current?.abort(); action.current = null;
    setBusy(null); setScenario(next); setPanel(false); setError(''); setNotice('');
  }
  async function openBilling(kind: 'checkout' | 'portal') {
    if (kind === 'portal') { setPanel(true); setNotice('Simulated billing settings. Your real subscription is unchanged.'); return; }
    if (action.current || useAppStore.getState().user?.id !== userId) return;
    const controller = new AbortController(); action.current = controller;
    setBusy('checkout'); setError('');
    try {
      const mode = sample.status?.trialEligible ? 'trial' : 'subscription';
      const response = await fetch(`/api/billing/preview/checkout?kind=${mode}`, { method: 'POST', signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error('Could not open test checkout. Check your sign-in and try again.');
      const target = new URL(result.url);
      if (result.sandbox !== true || target.protocol !== 'https:' || target.hostname !== 'buy.stripe.com'
        || target.port || !/^\/test_[A-Za-z0-9]+$/.test(target.pathname) || target.search || target.hash || target.username || target.password) {
        throw new Error('Test checkout address could not be verified.');
      }
      if (!controller.signal.aborted && useAppStore.getState().user?.id === userId) window.location.assign(target.href);
    } catch (cause) {
      if (!controller.signal.aborted && useAppStore.getState().user?.id === userId) setError(cause instanceof Error ? cause.message : 'Could not open test checkout.');
    } finally {
      if (action.current === controller) { action.current = null; if (!controller.signal.aborted) setBusy(null); }
    }
  }
  const billing: BillingView = { ...sample, busy, error: error || sample.error, openBilling,
    refresh: () => { setError(''); setNotice('Preview refreshed. No real billing status was changed.'); } };
  return <div className="space-y-4">
    {returned && <p role="status" className="rounded-xl border border-border p-3 text-sm">Back from test checkout. This return link does not confirm payment or change your real AI access.</p>}
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium"><FlaskConical className="h-4 w-4" aria-hidden="true" /> Test mode · no real charges</p>
      <p className="mt-1 text-muted-foreground">Buy and trial buttons below open Stripe’s sandbox. Manage subscription is simulated. Nothing here unlocks real AI or changes your account.</p>
      <p className="mt-2 text-xs text-muted-foreground">For test checkout, use card 4242 4242 4242 4242, any future expiry and any 3-digit CVC. Never enter a real card.</p>
    </div>
    <label className="block space-y-2 text-sm font-medium">Screen to preview
      <select value={scenario} onChange={event => choose(event.target.value as PreviewScenario)} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-primary">
        {Object.entries(previewScenarios).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {panel ? <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold">Billing settings · simulated</h3>
      <BillingDetails billing={billing} />
      {sample.status?.aiAccess && !sample.status.cancelAtPeriodEnd && <Button variant="outline" onClick={() => choose(scenario === 'trial' ? 'trialCanceled' : 'paidCanceled')}>Simulate cancellation</Button>}
      <Button variant="ghost" onClick={() => setPanel(false)}>Back to AI preview</Button>
    </div> : <AssistantAccessView billing={billing}>
      <div className="space-y-5 rounded-xl border border-border bg-card p-5 sm:p-7">
        <h3 className="flex items-center gap-2 font-semibold"><Sparkles aria-hidden="true" className="h-4 w-4 text-primary" /> Orderly AI · sample conversation</h3>
        <p className="ml-auto max-w-md rounded-2xl bg-primary/10 p-4 text-sm">Help me plan biology revision around soccer practice.</p>
        <p className="max-w-lg rounded-2xl border border-border p-4 text-sm text-muted-foreground">Here’s a sample plan: review chapter 4 at 4:00 PM, then leave room for practice at 5:30 PM. These are fictional tasks; nothing has been saved.</p>
        <input aria-label="Sample assistant composer" disabled placeholder="Preview only — your real assistant stays unchanged" className="h-12 w-full rounded-xl border border-input bg-muted/40 px-3 text-sm" />
      </div>
    </AssistantAccessView>}
  </div>;
}

export function BillingPreviewControl({ userId }: { userId: string }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    async function verify() {
      controller?.abort(); controller = new AbortController();
      const current = controller;
      try {
        const response = await fetch('/api/billing/preview', { cache: 'no-store', signal: current.signal });
        const result = await response.json();
        if (!active || current.signal.aborted || useAppStore.getState().user?.id !== userId) return;
        const permitted = response.ok && result.allowed === true && result.userId === userId;
        setAllowed(permitted); if (!permitted) setOpen(false);
      } catch {
        if (active && !current.signal.aborted) { setAllowed(false); setOpen(false); }
      }
    }
    void verify();
    const onFocus = () => { if (document.visibilityState === 'visible') void verify(); };
    window.addEventListener('focus', onFocus); window.addEventListener('pageshow', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; controller?.abort(); window.removeEventListener('focus', onFocus); window.removeEventListener('pageshow', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [userId]);
  if (!allowed) return null;
  return <div className="flex flex-wrap items-center justify-end gap-2">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Eye aria-hidden="true" className="h-4 w-4" /> Preview AI screens</Button></DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader className="pr-6">
          <DialogTitle>AI screen preview</DialogTitle>
          <DialogDescription>Only your verified account has this preview button. All account states shown here are simulated.</DialogDescription>
        </DialogHeader>
        {open && <PreviewScreens key={userId} userId={userId} />}
      </DialogContent>
    </Dialog>
  </div>;
}
