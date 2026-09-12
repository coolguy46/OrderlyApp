'use client';

import { type ReactNode } from 'react';
import { useAppStore } from '@/lib/store';
import { useBilling } from './useBilling';
import { AssistantAccessView } from './AssistantAccessView';
import { BillingPreviewControl } from './BillingPreviewControl';

function AccountGate({ userId, ...props }: { userId: string; children: ReactNode; recoveryActions?: ReactNode }) {
  const billing = useBilling(userId);
  return <>
    <BillingPreviewControl userId={userId} />
    <AssistantAccessView billing={billing} {...props} />
  </>;
}

export function AssistantSubscriptionGate(props: { children: ReactNode; recoveryActions?: ReactNode }) {
  const userId = useAppStore(state => state.user?.id);
  return userId ? <AccountGate key={userId} userId={userId} {...props} /> : null;
}
