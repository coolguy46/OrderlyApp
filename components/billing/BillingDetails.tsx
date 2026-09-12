'use client';

import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { billingDate, type BillingStatus, type BillingView } from './useBilling';

export function subscriptionMessage(status: BillingStatus) {
  const trialEnd = billingDate(status.trialEndsAt);
  const accessEnd = billingDate(status.accessEndsAt);
  if (status.aiAccess && status.status === 'trialing') return status.cancelAtPeriodEnd
    ? `Trial canceled. AI access continues${accessEnd || trialEnd ? ` until ${accessEnd || trialEnd}` : ' until your trial ends'}. You will not be charged.`
    : `Your free trial is active.${trialEnd ? ` First charge: $4.99 USD on ${trialEnd}.` : ' Your first charge date is available in Stripe.'}`;
  if (status.aiAccess) return status.cancelAtPeriodEnd
    ? `Renewal canceled. AI access continues${accessEnd ? ` until ${accessEnd}` : ' until your paid period ends'}. You will not be charged again.`
    : `Subscription active.${accessEnd ? ` Next renewal: ${accessEnd}.` : ''}`;
  if (status.hasSubscription) return 'Your subscription needs attention. Manage your subscription to check its payment status.';
  return 'No active AI subscription.';
}

export function BillingDetails({ billing, dark = false }: { billing: BillingView; dark?: boolean }) {
  const { status, error, checking, busy, returnState, refresh, openBilling } = billing;
  const trial = status?.trialEligible === true && !status.hasSubscription;
  const muted = dark ? 'text-slate-300' : 'text-muted-foreground';
  const outline = dark ? 'border-white/20 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white' : '';
  return <div className="min-w-0 space-y-4">
    <div>
      {trial && <p className={`mb-1 text-sm font-medium ${dark ? 'text-violet-200' : 'text-primary'}`}>Your first 7 days are free</p>}
      <p><span className="text-3xl font-semibold tracking-tight">{trial ? '$0' : '$4.99'}</span><span className={`ml-1.5 text-sm ${muted}`}>{trial ? 'for 7 days' : 'USD / month'}</span></p>
      {trial && <p className={`mt-1 text-sm ${muted}`}>Then $4.99 USD / month</p>}
    </div>
    {checking && !status && <p role="status" className={`text-sm ${muted}`}>Checking AI access…</p>}
    {status?.enabled && <>
      {!status.hasSubscription && <p className={`text-xs leading-relaxed ${muted}`}>{trial
        ? 'Payment method required. Your first charge date is shown at checkout. Cancel before the trial ends and pay nothing; otherwise your subscription renews monthly.'
        : 'Billed monthly. Cancel anytime to stop your next renewal and keep AI access until your paid period ends.'}</p>}
      {!trial && !status.hasSubscription && status.trialEligible === false && <p className={`text-xs ${muted}`}>The free trial is available only once per account.</p>}
      {status.hasSubscription && <p role="status" className={`text-sm leading-relaxed ${muted}`}>{subscriptionMessage(status)}</p>}
      {status.sandbox && <p className={`rounded-lg p-3 text-xs ${dark ? 'bg-white/5 text-slate-300' : 'bg-muted text-muted-foreground'}`}>Sandbox preview — no real payments.</p>}
      {!status.subscriptionRequired && <p className={`text-xs ${muted}`}>The AI paywall is not enabled during setup.</p>}
    </>}
    {returnState === 'success' && !status?.aiAccess && <p role="status" className={`text-sm ${muted}`}>Checking your checkout with Stripe. AI unlocks only when your subscription is confirmed.</p>}
    {returnState === 'canceled' && !status?.aiAccess && <p role="status" className={`text-sm ${muted}`}>Checkout wasn’t completed. You can start again whenever you’re ready.</p>}
    {status && !status.enabled && <p role="status" className={`text-sm ${muted}`}>Checkout is not enabled in this environment yet.</p>}
    {status?.enabled && status.checkoutEnabled === false && <p role="status" className={`text-sm ${muted}`}>New subscriptions are not available yet. Existing subscribers can still manage billing.</p>}
    {error && <p role="alert" className={`text-sm ${dark ? 'text-rose-200' : 'text-destructive'}`}>{error}</p>}
    <div className="flex flex-col items-stretch gap-2">
      {status?.enabled && status.checkoutEnabled !== false && !status.hasSubscription && <Button variant="secondary" className="h-auto min-h-11 whitespace-normal bg-violet-600 px-4 text-white hover:bg-violet-700" disabled={!!busy || checking} onClick={() => void openBilling('checkout')}>
        {busy === 'checkout' ? 'Opening secure checkout…' : trial ? 'Start 7-day free trial' : 'Subscribe for $4.99/month'}{!busy && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
      </Button>}
      {status?.enabled && status.canManage && <Button className={`h-auto min-h-10 whitespace-normal ${outline}`} variant="outline" disabled={!!busy || checking} onClick={() => void openBilling('portal')}>{busy === 'portal' ? 'Opening Stripe…' : 'Manage subscription'}</Button>}
      <Button className={dark ? 'text-slate-300 hover:bg-white/5 hover:text-white' : ''} variant="ghost" disabled={checking || !!busy} onClick={refresh}>{checking ? 'Checking…' : 'Refresh status'}</Button>
    </div>
    <div className={`flex flex-wrap items-center justify-between gap-2 text-[11px] ${muted}`}>
      <span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> Secure checkout by Stripe</span>
      <span className="flex gap-3"><Link className="rounded underline underline-offset-2 focus-visible:outline-2" href="/terms">Terms</Link><Link className="rounded underline underline-offset-2 focus-visible:outline-2" href="/privacy">Privacy</Link></span>
    </div>
  </div>;
}
