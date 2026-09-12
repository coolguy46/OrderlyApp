'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';

export interface BillingStatus {
  enabled: boolean;
  sandbox?: boolean;
  checkoutEnabled?: boolean;
  subscriptionRequired: boolean;
  aiAccess?: boolean;
  hasSubscription?: boolean;
  canManage?: boolean;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  trialEligible?: boolean;
  trialEndsAt?: string | null;
  accessEndsAt?: string | null;
}

/** Client presentation only: server routes make every entitlement decision. */
export function useBilling(userId: string, initialReturnState = '') {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);
  const [returnState, setReturnState] = useState(initialReturnState);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const action = useRef<AbortController | null>(null);
  const ownsResult = useCallback(() => mounted.current && useAppStore.getState().user?.id === userId, [userId]);

  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return fetch('/api/billing/status', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result: BillingStatus & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check AI access. Please retry.');
      if (!result || typeof result.enabled !== 'boolean' || typeof result.subscriptionRequired !== 'boolean'
        || (result.subscriptionRequired && typeof result.aiAccess !== 'boolean')) throw new Error('Could not check AI access. Please retry.');
      if (ownsResult() && !controller.signal.aborted) {
        setStatus(result);
        setError('');
        const returned = new URLSearchParams(window.location.search).get('checkout');
        if (returned === 'success' || returned === 'canceled') setReturnState(returned);
      }
    }).catch(cause => {
      if (ownsResult() && !controller.signal.aborted) {
        // Fail closed instead of leaving stale paid access visible after a failed refresh.
        setStatus(null);
        setError(cause instanceof Error ? cause.message : 'Could not check AI access. Please retry.');
      }
    }).finally(() => {
      if (ownsResult() && !controller.signal.aborted) setChecking(false);
    });
  }, [ownsResult]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    window.addEventListener('popstate', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      mounted.current = false;
      request.current?.abort();
      action.current?.abort();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      window.removeEventListener('popstate', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  // A return URL is never proof of payment. Briefly recheck while Stripe finalizes checkout.
  useEffect(() => {
    if (returnState !== 'success' || status?.aiAccess || !status?.enabled) return;
    const timers = [2000, 5000, 10000].map(delay => window.setTimeout(() => void refresh(), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [returnState, status?.aiAccess, status?.enabled, refresh]);

  useEffect(() => {
    const expirations = [status?.trialEndsAt, status?.accessEndsAt]
      .filter((value): value is string => typeof value === 'string')
      .map(value => Date.parse(value)).filter(Number.isFinite);
    if (!status?.aiAccess || !expirations.length) return;
    const remaining = Math.min(...expirations) - Date.now();
    if (!Number.isFinite(remaining) || remaining < 0) return;
    const timer = window.setTimeout(() => void refresh(), Math.min(remaining + 1000, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [status?.aiAccess, status?.trialEndsAt, status?.accessEndsAt, refresh]);

  async function openBilling(kind: 'checkout' | 'portal') {
    if (action.current || !ownsResult()) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(kind);
    setError('');
    try {
      const response = await fetch(`/api/billing/${kind}`, { method: 'POST', signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not open Stripe. Please try again.');
      const target = new URL(result.url);
      if (target.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname)
        || target.username || target.password) throw new Error('Unexpected checkout address. Please try again.');
      if (ownsResult() && !controller.signal.aborted) window.location.assign(target.href);
    } catch (cause) {
      if (ownsResult() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not open Stripe. Please try again.');
    } finally {
      action.current = null;
      if (ownsResult() && !controller.signal.aborted) setBusy(null);
    }
  }

  return { status, error, checking, busy, returnState, openBilling, refresh: () => { setChecking(true); void refresh(); } };
}

export type BillingView = ReturnType<typeof useBilling>;

export function billingDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
