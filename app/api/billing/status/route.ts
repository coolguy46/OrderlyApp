import { createSupabaseServerClient } from '@/lib/supabase/server';
import { billingFailure, billingJson } from '@/lib/billing/config';
import { billingServer } from '@/lib/billing/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (process.env.STRIPE_BILLING_ENABLED !== 'true') {
    // A bad rollout must never advertise access while the provider guard denies it.
    if (process.env.AI_SUBSCRIPTION_REQUIRED === 'true') return billingJson({ error: 'Subscription verification is unavailable.' }, 503);
    return billingJson({ enabled: false, subscriptionRequired: false });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return billingJson({ error: 'Sign in to view your subscription.' }, 401);
    const { service } = await billingServer();
    return billingJson({ ...await service.status(user.id), subscriptionRequired: process.env.AI_SUBSCRIPTION_REQUIRED === 'true' });
  } catch (error) { return billingFailure(error); }
}
