import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  CanvasFeedUrlValidationError,
  normalizeCanvasFeedUrl,
} from '@/lib/integrations/canvas-feed-url';
import { getCanvasFeedSummary } from '@/lib/integrations/canvas-server-sync';
import {
  isCanvasProviderThrottleMigrationError,
  parseCanvasProviderRequestClaim,
} from '@/lib/integrations/canvas-provider-request';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_REQUEST_BYTES = 4_096;

/** Validate a private Canvas feed without persisting it to the user's account. */
export async function POST(request: Request) {
  const sessionClient = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Canvas feed URL is too long' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const rawUrl = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).icalUrl
    : null;
  if (typeof rawUrl !== 'string') {
    return NextResponse.json({ error: 'Canvas feed URL is required' }, { status: 400 });
  }

  try {
    const icalUrl = normalizeCanvasFeedUrl(rawUrl);
    const { data, error } = await sessionClient.rpc('claim_canvas_provider_request', {
      requested_kind: 'validate',
    });
    if (error) {
      if (isCanvasProviderThrottleMigrationError(error)) {
        return NextResponse.json(
          { error: 'Canvas validation requires a database migration' },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: 'Canvas validation is temporarily unavailable' },
        { status: 503 },
      );
    }

    let claim;
    try {
      claim = parseCanvasProviderRequestClaim(data);
    } catch {
      return NextResponse.json(
        { error: 'Canvas validation is temporarily unavailable' },
        { status: 503 },
      );
    }

    if (!claim.token) {
      return NextResponse.json(
        { error: 'Please wait before validating another Canvas feed.' },
        {
          status: 429,
          headers: { 'Retry-After': String(claim.retryAfterSeconds) },
        },
      );
    }

    try {
      const summary = await getCanvasFeedSummary(icalUrl);
      return NextResponse.json({ valid: true, ...summary });
    } finally {
      const { error: releaseError } = await sessionClient.rpc(
        'release_canvas_provider_request',
        {
          requested_kind: 'validate',
          expected_claim_token: claim.token,
        },
      );
      if (releaseError) {
        // The claim expires automatically. Do not expose the private feed URL
        // or turn a completed validation into a client-visible failure.
        console.error('Canvas validation throttle release failed');
      }
    }
  } catch (error) {
    if (error instanceof CanvasFeedUrlValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Feed errors can retain the private URL in nested request metadata. Keep
    // both logs and the client response free of the thrown object.
    console.error(`Canvas setup validation failed (${error instanceof Error ? error.name : 'UnknownError'})`);
    return NextResponse.json(
      { error: 'Orderly could not read that Canvas feed. Copy a fresh Calendar Feed URL and try again.' },
      { status: 422 },
    );
  }
}
