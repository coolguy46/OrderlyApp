import { requireBillingPreviewOwner } from '@/lib/billing/preview-access';
import { billingFailure, billingJson } from '@/lib/billing/config';

export const runtime = 'nodejs';
export async function GET() {
  try { return billingJson({ allowed: true, userId: await requireBillingPreviewOwner() }); }
  catch (error) { return billingFailure(error); }
}
