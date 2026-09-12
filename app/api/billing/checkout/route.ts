import { createSupabaseServerClient } from '@/lib/supabase/server';
import { guardMutationRequest } from '@/lib/security/request';
import { billingConfig, BillingError, billingFailure, billingJson } from '@/lib/billing/config';
import { billingServer } from '@/lib/billing/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const rejected = guardMutationRequest(request);
  if (rejected) return rejected;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return billingJson({ error: 'Sign in to subscribe.' }, 401);
    if (new URL(request.url).origin !== billingConfig().origin) throw new BillingError('Open checkout from the configured Orderly website.', 403);
    // No price, customer, user ID, quantity, or return URL is accepted from the body.
    const { service } = await billingServer();
    return billingJson(await service.checkout(user.id));
  } catch (error) { return billingFailure(error); }
}
