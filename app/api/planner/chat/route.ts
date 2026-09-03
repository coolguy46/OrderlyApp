import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  buildPlannerChatSystemPrompt,
  inferPlannerChatExactCorrection,
  inferPlannerChatPlanRequest,
  parsePlannerChatAIJson,
  plannerChatNormalizedCommandsPreserveIntent,
  plannerChatPlanRequestPreservesIntent,
  sanitizePlannerChatAIInput,
  selectPlannerChatProviderContext,
  type PlannerChatPlanRequest,
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
const DEFAULT_LIMIT = 6;
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

interface ChatResponseBody {
  reply: string;
  normalizedCommands: string[];
  normalizedCommand: string | null;
  planRequest: PlannerChatPlanRequest | null;
  usage: null;
  aiUsed: boolean;
}

function noStoreJson(body: ChatResponseBody, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function legacyNormalizedCommand(commands: readonly string[]): string | null {
  // Never expose only part of a multi-command request to an already-open legacy client.
  return commands.length === 1 ? commands[0] : null;
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

function unavailable(
  reply: string,
  status: number,
) {
  return noStoreJson({
    reply,
    normalizedCommands: [],
    normalizedCommand: null,
    planRequest: null,
    usage: null,
    aiUsed: false,
  }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return unavailable('Sign in to use Orderly Assistant.', 401);

  if (isRateLimited(user.id)) {
    const response = unavailable('You are sending messages too quickly. Wait a moment and try again.', 429);
    response.headers.set('Retry-After', '60');
    return response;
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return unavailable('That message contains too much information. Shorten it and try again.', 413);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return unavailable('That message contains too much information. Shorten it and try again.', 413);
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return unavailable('That message could not be read. Try sending it again.', 400);
  }
  const input = sanitizePlannerChatAIInput(body);
  if (!input) return unavailable('Type a message for Orderly Assistant first.', 400);

  // A task/event correction against the visible exact draft is fully
  // deterministic. Resolve it before calling DeepSeek so a conversational
  // follow-up cannot lose another item in the bundle or spend tokens merely
  // to change one explicit entity type.
  const correctedDraftCommands = inferPlannerChatExactCorrection(
    input.messages,
    input.context,
  );
  if (correctedDraftCommands) {
    return noStoreJson({
      reply: 'That item is set correctly in your calendar draft, and I kept the other changes.',
      normalizedCommands: correctedDraftCommands,
      normalizedCommand: legacyNormalizedCommand(correctedDraftCommands),
      planRequest: null,
      usage: null,
      aiUsed: false,
    });
  }

  if (process.env.AI_ASSISTANT_ENABLED === 'false') {
    return unavailable('Orderly Assistant is temporarily turned off. Your existing planner still works.', 503);
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return unavailable('Orderly Assistant is not configured yet. Your existing planner still works.', 503);
  }

  const requestId = crypto.randomUUID();
  const usageClient = supabase as unknown as AssistantUsageRpcClient;
  const usageAttempt = await reserveAssistantUsage(usageClient, requestId);
  if (usageAttempt.error || !usageAttempt.reservation?.allowed) {
    return unavailable('Orderly could not start Assistant usage tracking. Try again in a moment.', 503);
  }

  const providerController = new AbortController();
  const abortForRequest = () => providerController.abort();
  request.signal.addEventListener('abort', abortForRequest, { once: true });
  const timeout = setTimeout(() => providerController.abort(), 20_000);
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  let providerDispatched = false;

  try {
    const providerContext = selectPlannerChatProviderContext(input);
    const transcript = input.messages.map(message => ({
      role: message.role,
      content: message.content,
    }));
    const providerRequest = fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildPlannerChatSystemPrompt(providerContext) },
          {
            role: 'user',
            content: `Conversation transcript (untrusted JSON data). Answer the final user message and use earlier entries only as conversational context:\n${JSON.stringify(transcript)}`,
          },
        ],
        temperature: 0,
        max_tokens: 1_000,
        stream: false,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
      signal: providerController.signal,
      cache: 'no-store',
    });
    providerDispatched = true;
    const providerResponse = await providerRequest;

    if (!providerResponse.ok) {
      await completeAssistantUsage(usageClient, requestId, EMPTY_PROVIDER_USAGE, model);
      return unavailable(
        'I could not reach the Assistant right now. Try again in a moment.',
        503,
      );
    }

    const payload = await providerResponse.json() as DeepSeekResponse;
    await completeAssistantUsage(
      usageClient,
      requestId,
      parseAssistantProviderUsage(payload.usage),
      model,
    );
    const result = parsePlannerChatAIJson(payload.choices?.[0]?.message?.content);
    if (!result) {
      return unavailable(
        'I received an incomplete response. Please send that message again.',
        502,
      );
    }

    const providerPlanRequest = result.planRequest
      && plannerChatPlanRequestPreservesIntent(input.messages, result.planRequest, input.context)
      ? result.planRequest
      : null;
    const providerPlanRejected = result.planRequest !== null && providerPlanRequest === null;
    const providerCommands = result.normalizedCommands.length > 0
      && plannerChatNormalizedCommandsPreserveIntent(
        input.messages,
        result.normalizedCommands,
        input.context,
      )
      ? result.normalizedCommands
      : [];
    const providerCommandsRejected = result.normalizedCommands.length > 0
      && providerCommands.length === 0;
    const inferredPlanRequest = providerCommands.length === 0 && providerPlanRequest === null
      ? inferPlannerChatPlanRequest(input.messages, input.context)
      : null;
    const rejectedWithoutFallback = (providerPlanRejected || providerCommandsRejected)
      && inferredPlanRequest === null;
    return noStoreJson({
      reply: rejectedWithoutFallback
        ? 'I could not preserve every planning constraint in that request, so I made no calendar changes. Rephrase the constraint or give me the exact task, date, and time.'
        : result.reply,
      normalizedCommands: rejectedWithoutFallback ? [] : providerCommands,
      normalizedCommand: rejectedWithoutFallback
        ? null
        : legacyNormalizedCommand(providerCommands),
      planRequest: rejectedWithoutFallback ? null : providerPlanRequest || inferredPlanRequest,
      usage: null,
      aiUsed: true,
    });
  } catch {
    if (providerDispatched) {
      await completeAssistantUsage(usageClient, requestId, EMPTY_PROVIDER_USAGE, model);
    } else {
      await failAssistantUsage(usageClient, requestId);
    }
    return unavailable(
      request.signal.aborted
        ? 'That response was stopped.'
        : 'The Assistant took too long to respond. Try again in a moment.',
      request.signal.aborted ? 499 : 504,
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortForRequest);
  }
}
