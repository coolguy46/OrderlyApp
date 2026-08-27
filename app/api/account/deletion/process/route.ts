import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  claimAccountDeletionRequests,
  processAccountDeletionRequest,
} from '@/lib/account-deletion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Storage cleanup itself is bounded, and processing only two accounts keeps a
// single serverless invocation comfortably inside its function budget.
const MAX_REQUESTS_PER_RUN = 2;

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CANVAS_SYNC_CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Account deletion worker is not configured' }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const requests = await claimAccountDeletionRequests(admin, MAX_REQUESTS_PER_RUN);
    const results: Array<{ completed: boolean; failed: boolean }> = [];
    for (const deletionRequest of requests) {
      try {
        const result = await processAccountDeletionRequest(admin, deletionRequest);
        results.push({ completed: result.completed, failed: false });
      } catch (error) {
        // The durable lease expires and makes this request claimable again. Do
        // not let one dependency failure starve the other claimed accounts.
        console.error(
          'Account deletion request failed:',
          error instanceof Error ? error.message : 'unknown',
        );
        results.push({ completed: false, failed: true });
      }
    }
    return NextResponse.json({
      claimed: requests.length,
      completed: results.filter(result => result.completed).length,
      retrying: results.filter(result => !result.completed && !result.failed).length,
      failed: results.filter(result => result.failed).length,
    });
  } catch (error) {
    console.error(
      'Account deletion worker failed:',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json({ error: 'Account deletion worker failed' }, { status: 500 });
  }
}
