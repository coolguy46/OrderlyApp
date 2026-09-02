import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  PLANNER_COMMAND_SYSTEM_PROMPT,
  buildPlannerCommandUserPrompt,
  parsePlannerCommandAIJson,
  sanitizePlannerCommandAIInput,
} from '@/lib/planner/deepseek-command';
import {
  completeAssistantUsage,
  failAssistantUsage,
  parseAssistantProviderUsage,
  reserveAssistantUsage,
  type AssistantProviderUsage,
  type AssistantUsageRpcClient,
} from '@/lib/planner/assistant-usage';

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

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: unknown;
}
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
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return noStoreJson({ error: 'Unauthorized' }, { status: 401 });

  if (isRateLimited(user.id)) {
    const response = noStoreJson({ error: 'Too many Assistant requests. Wait a minute and try again.' }, { status: 429 });
    response.headers.set('Retry-After', '60');
    return response;
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return noStoreJson({ error: 'Request is too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return noStoreJson({ error: 'Request is too large' }, { status: 413 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return noStoreJson({ error: 'Invalid request' }, { status: 400 });
  }
  const input = sanitizePlannerCommandAIInput(body);
  if (!input) return noStoreJson({ error: 'Type a schedule request first.' }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || process.env.AI_ASSISTANT_ENABLED === 'false') {
    return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
  }

  const requestId = crypto.randomUUID();
  const usageClient = supabase as unknown as AssistantUsageRpcClient;
  const usageAttempt = await reserveAssistantUsage(usageClient, requestId);
  if (usageAttempt.error || !usageAttempt.reservation) {
    return noStoreJson(
      { normalizedCommand: input.prompt, aiUsed: false, error: 'Assistant usage limits are unavailable' },
      { status: 503 },
    );
  }
  if (!usageAttempt.reservation.allowed) {
    return noStoreJson(
      { normalizedCommand: input.prompt, aiUsed: false, error: 'Assistant message limit reached' },
      { status: 429 },
    );
  }

  const controller = new AbortController();
  const abortForRequest = () => controller.abort();
  request.signal.addEventListener('abort', abortForRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
    const providerRequest = fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PLANNER_COMMAND_SYSTEM_PROMPT },
          { role: 'user', content: buildPlannerCommandUserPrompt(providerInput) },
        ],
        temperature: 0,
        max_tokens: 500,
        stream: false,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    providerDispatched = true;
    const response = await providerRequest;
    if (!response.ok) {
      await completeAssistantUsage(usageClient, requestId, EMPTY_PROVIDER_USAGE, model);
      return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
    }
    const payload = await response.json() as DeepSeekResponse;
    await completeAssistantUsage(
      usageClient,
      requestId,
      parseAssistantProviderUsage(payload.usage),
      model,
    );
    const normalizedCommand = parsePlannerCommandAIJson(payload.choices?.[0]?.message?.content);
    return noStoreJson({
      normalizedCommand: normalizedCommand || input.prompt,
      aiUsed: Boolean(normalizedCommand),
      usage: usageAttempt.reservation.usage,
    });
  } catch {
    if (providerDispatched) {
      await completeAssistantUsage(usageClient, requestId, EMPTY_PROVIDER_USAGE, model);
    } else {
      await failAssistantUsage(usageClient, requestId);
    }
    return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortForRequest);
  }
}
