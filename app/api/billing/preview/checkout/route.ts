import { requireBillingPreviewOwner } from '@/lib/billing/preview-access';
import { previewCheckout } from '@/lib/billing/preview-checkout';
import { billingFailure, billingJson } from '@/lib/billing/config';
import { guardMutationRequest } from '@/lib/security/request';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const rejected = guardMutationRequest(request);
  if (rejected) return rejected;
  try {
    await requireBillingPreviewOwner();
    // Never accept a price, user, customer, URL, or live/test switch from the caller.
    return billingJson(previewCheckout(new URL(request.url).searchParams.get('kind')));
  } catch (error) { return billingFailure(error); }
}
