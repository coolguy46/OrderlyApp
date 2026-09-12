'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAppStore } from '@/lib/store';
import { BillingDetails } from './BillingDetails';
import { useBilling } from './useBilling';

function AccountBillingPanel({ userId, returnState }: { userId: string; returnState: string }) {
  const billing = useBilling(userId, returnState);
  return <Card>
    <CardHeader><CardTitle>Orderly AI</CardTitle><p className="text-muted-foreground text-sm">Your personal planner, connected to your tasks and calendar.</p></CardHeader>
    <CardContent className="space-y-5">
      <BillingDetails billing={billing} />
      <p className="border-t border-border pt-4 text-sm text-muted-foreground">Only AI is paid. Tasks, calendars, manual scheduling, Canvas integration, goals, and study tools stay free.</p>
      <Link className="inline-block rounded text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2" href="/planner">Back to your assistant</Link>
    </CardContent>
  </Card>;
}

export function BillingPanel({ returnState = '' }: { returnState?: string }) {
  const userId = useAppStore(state => state.user?.id);
  return userId ? <AccountBillingPanel key={userId} userId={userId} returnState={returnState} /> : <p><Link href="/auth/login" className="underline">Sign in</Link> to view billing.</p>;
}
