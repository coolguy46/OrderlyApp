import { NextResponse } from 'next/server';
import { guardMutationRequest } from '@/lib/security/request';
import { billingServer } from '@/lib/billing/server';
import { billingFailure } from '@/lib/billing/config';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hasRecentSessionAuthentication } from '@/lib/auth/recent-auth';
import {
  claimAccountDeletionRequests,
  processAccountDeletionRequest,
} from '@/lib/account-deletion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function DELETE(request: Request) {
  const rejected = guardMutationRequest(request);
  if (rejected) return rejected;
  const sessionClient = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await sessionClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: claimData, error: claimError } = await sessionClient.auth.getClaims();
  if (claimError || !hasRecentSessionAuthentication(claimData?.claims, user.id)) {
    return NextResponse.json(
      { error: 'For your security, sign out and sign back in before deleting your account.' },
      { status: 403 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Account deletion is not configured' }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Do not delete the owner of a recurring subscription or an open checkout.
  if (process.env.STRIPE_BILLING_ENABLED === 'true') {
    try { await (await billingServer()).service.prepareDeletion(user.id); }
    catch (error) { return billingFailure(error); }
  }

  const { error: enqueueError } = await admin
    .from('account_deletion_requests')
    .upsert(
      { user_id: user.id },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
  if (enqueueError) {
    console.error('Could not enqueue account deletion:', enqueueError.code ?? 'unknown');
    return NextResponse.json(
      { error: 'Account deletion is temporarily unavailable' },
      { status: enqueueError.code === '42P01' ? 503 : 500 },
    );
  }

  let completed = false;
  try {
    const [request] = await claimAccountDeletionRequests(admin, 1, user.id);
    if (request) {
      completed = (await processAccountDeletionRequest(admin, request)).completed;
    } else {
      const { data } = await admin
        .from('account_deletion_requests')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();
      completed = data?.status === 'completed';
    }
  } catch (error) {
    // Enqueue already succeeded, so a worker can safely resume after this
    // request's function budget or a transient dependency failure.
    console.error(
      'Immediate account deletion progress failed:',
      error instanceof Error ? error.message : 'unknown',
    );
  }

  if (completed) {
    return NextResponse.json({ success: true, status: 'completed' });
  }
  return NextResponse.json(
    {
      success: true,
      status: 'queued',
      message: 'Account deletion is queued and will continue automatically.',
    },
    { status: 202 },
  );
}
