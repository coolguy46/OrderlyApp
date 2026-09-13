import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assistantSubscriptionRequired, billingFailure, billingJson } from '@/lib/billing/config';
import { billingServer } from '@/lib/billing/server';
import { isOrderlyOwner } from '@/lib/billing/owner-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const subscriptionRequired = assistantSubscriptionRequired();
  const billingEnabled = process.env.STRIPE_BILLING_ENABLED === 'true';
  const setupStatus = () => billingJson(subscriptionRequired
    ? { enabled: false, subscriptionRequired: true, checkoutEnabled: false, aiAccess: false, status: 'unavailable' }
    : { enabled: false, subscriptionRequired: false });
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    // Authenticate even during billing setup: only this verified account is exempt.
    // Never derive the exception from a query, request body, client store or preview.
    if (!error && user && isOrderlyOwner(user)) {
      let subscription = {};
      if (billingEnabled) {
        try {
          const { service } = await billingServer();
          subscription = await service.status(user.id);
        } catch { /* Billing outages cannot revoke complimentary owner access. */ }
      }
      // Preserve real subscription/portal details when available. Owner access
      // does not fabricate a paid/trial status or cancel any existing subscription.
      return billingJson({ enabled: false, checkoutEnabled: false, status: 'owner',
        ...subscription, subscriptionRequired, aiAccess: true, ownerAccess: true });
    }
    if (!billingEnabled) return setupStatus();
    if (error || !user) return billingJson({ error: 'Sign in to view your subscription.' }, 401);
    const { service } = await billingServer();
    return billingJson({ ...await service.status(user.id), subscriptionRequired });
  } catch (error) { return billingEnabled ? billingFailure(error) : setupStatus(); }
}
