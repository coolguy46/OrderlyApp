import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAssistantSubscription } from '@/lib/billing/server';
import type { AssistantBillingPeriod } from '@/lib/billing/plan';
import {
  PLANNER_COMMAND_SYSTEM_PROMPT,
  buildPlannerCommandUserPrompt,
  parsePlannerCommandAIJson,
  sanitizePlannerCommandAIInput,
} from '@/lib/planner/deepseek-command';
import {
  bindAssistantUsageClient,
  completeAssistantUsage,
  failAssistantUsage,
  parseAssistantProviderUsage,
  reserveAssistantUsage,
  type AssistantProviderUsage,
} from '@/lib/planner/assistant-usage';
import { fetchBudgetedAssistantProvider, AssistantTokenLimitError } from '@/lib/planner/assistant-budget';
import { guardMutationRequest, readJsonBody, requestBodyErrorResponse } from '@/lib/security/request';
import { assistantProviderBody, AssistantContextCapacityError, readAssistantProviderResponse } from '@/lib/planner/assistant-provider';
import { acquireAssistantLease, assistantLeaseFailure, releaseAssistantLease } from '@/lib/planner/assistant-abuse';
import { createAssistantAbuseClient } from '@/lib/planner/assistant-abuse-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_REQUEST_BYTES = 96 * 1024;
const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 12;
const EMPTY_PROVIDER_USAGE: AssistantProviderUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};
const requestWindows = new Map<string, { startedAt: number; count: number }>();

function noStoreJson(body: object, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const configured = Number(process.env.DEEPSEEK_REQUESTS_PER_MINUTE);
  const limit = Number.isFinite(configured) && configured > 0
    ? Math.min(60, Math.floor(configured))
    : DEFAULT_LIMIT;
  const current = requestWindows.get(userId);
  for (const [id, window] of requestWindows) if (now - window.startedAt >= WINDOW_MS) requestWindows.delete(id);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

export async function POST(request: NextRequest) {
  const providerDeadline = Date.now() + 20_000;
  const rejectedOrigin = guardMutationRequest(request);
  if (rejectedOrigin) return rejectedOrigin;
  const supabase = await createSupabaseServerClient({ deadline: providerDeadline + 5_000 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return noStoreJson({ error: 'Unauthorized' }, { status: 401 });

  if (isRateLimited(user.id)) {
    const response = noStoreJson({ error: 'Too many Assistant requests. Wait a minute and try again.' }, { status: 429 });
    response.headers.set('Retry-After', '60');
    return response;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return noStoreJson({ error: 'Invalid request' }, { status: 400 });
  }
  const input = sanitizePlannerCommandAIInput(body);
  if (!input) return noStoreJson({ error: 'Type a schedule request first.' }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  let billingPeriod: AssistantBillingPeriod | undefined;
  const subscriptionDenied = await requireAssistantSubscription(user, period => { billingPeriod = period; });
  if (subscriptionDenied) return subscriptionDenied;
  if (!apiKey || process.env.AI_ASSISTANT_ENABLED === 'false') {
    return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
  }

  const requestId = crypto.randomUUID();
  const abuseClient = createAssistantAbuseClient(providerDeadline + 5_000);
  const lease = await acquireAssistantLease(abuseClient, user.id, requestId);
  if (!lease.allowed) {
    const failure = assistantLeaseFailure(lease);
    return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false, error: failure.message }, { status: failure.status, headers: failure.headers });
  }
  const usageClient = bindAssistantUsageClient(abuseClient, user.id);
  const usageRequestId = lease.leaseId!;
  const usageAttempt = await reserveAssistantUsage(usageClient, usageRequestId);
  if (usageAttempt.error || !usageAttempt.reservation) {
    await releaseAssistantLease(abuseClient, user.id, lease.leaseId);
    return noStoreJson(
      { normalizedCommand: input.prompt, aiUsed: false, error: 'Assistant usage limits are unavailable' },
      { status: 503 },
    );
  }
  if (!usageAttempt.reservation.allowed) {
    await releaseAssistantLease(abuseClient, user.id, lease.leaseId);
    return noStoreJson(
      { normalizedCommand: input.prompt, aiUsed: false, error: 'Assistant message limit reached' },
      { status: 429 },
    );
  }

  const controller = new AbortController();
  const abortForRequest = () => controller.abort();
  request.signal.addEventListener('abort', abortForRequest, { once: true });
  if (request.signal.aborted || Date.now() >= providerDeadline) abortForRequest();
  const timeout = setTimeout(() => controller.abort(), Math.max(0, providerDeadline - Date.now()));
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  let providerDispatched = false;
  const providerInput = {
    ...input,
    context: {
      ...input.context,
      tasks: input.context.tasks.map(task => ({ ...task, description: null })),
      exams: input.context.exams.map(exam => ({ ...exam, description: null })),
    },
  };
  try {
    const providerBody = assistantProviderBody(model, [
      { role: 'system', content: PLANNER_COMMAND_SYSTEM_PROMPT },
      { role: 'user', content: buildPlannerCommandUserPrompt(providerInput) },
    ], 500);
    if (controller.signal.aborted || Date.now() >= providerDeadline) throw new Error('Assistant request timed out');
    const providerRequest = fetchBudgetedAssistantProvider(abuseClient, user.id, usageRequestId, providerBody, {
      apiKey, signal: controller.signal, deadline: providerDeadline, billingPeriod, onDispatch: () => { providerDispatched = true; },
    });
    const response = await providerRequest;
    if (!response.ok) {
      await completeAssistantUsage(usageClient, usageRequestId, EMPTY_PROVIDER_USAGE, model);
      return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
    }
    const payload = await readAssistantProviderResponse(response);
    await completeAssistantUsage(
      usageClient,
      usageRequestId,
      parseAssistantProviderUsage(payload.usage),
      model,
    );
    const normalizedCommand = parsePlannerCommandAIJson(payload.choices?.[0]?.message?.content);
    return noStoreJson({
      normalizedCommand: normalizedCommand || input.prompt,
      aiUsed: Boolean(normalizedCommand),
      usage: usageAttempt.reservation.usage,
    });
  } catch (error) {
    if (error instanceof AssistantTokenLimitError) {
      if (providerDispatched) await completeAssistantUsage(usageClient, usageRequestId, EMPTY_PROVIDER_USAGE, model);
      else await failAssistantUsage(usageClient, usageRequestId);
      return noStoreJson({ error: error.message, aiUsed: false, normalizedCommand: null }, { status: 429 });
    }
    if (providerDispatched) {
      await completeAssistantUsage(usageClient, usageRequestId, EMPTY_PROVIDER_USAGE, model);
    } else {
      await failAssistantUsage(usageClient, usageRequestId);
    }
    return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false,
      ...(error instanceof AssistantContextCapacityError ? { error: error.message } : {}) });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortForRequest);
    await releaseAssistantLease(abuseClient, user.id, lease.leaseId);
  }
}
