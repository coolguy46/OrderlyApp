import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  PLANNER_COMMAND_SYSTEM_PROMPT,
  buildPlannerCommandUserPrompt,
  parsePlannerCommandAIJson,
  sanitizePlannerCommandAIInput,
} from '@/lib/planner/deepseek-command';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 12;
const requestWindows = new Map<string, { startedAt: number; count: number }>();

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: 'Invalid request' }, { status: 400 });
  }
  const input = sanitizePlannerCommandAIInput(body);
  if (!input) return noStoreJson({ error: 'Type a schedule request first.' }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: PLANNER_COMMAND_SYSTEM_PROMPT },
          { role: 'user', content: buildPlannerCommandUserPrompt(input) },
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
    if (!response.ok) return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
    const payload = await response.json() as DeepSeekResponse;
    const normalizedCommand = parsePlannerCommandAIJson(payload.choices?.[0]?.message?.content);
    return noStoreJson({
      normalizedCommand: normalizedCommand || input.prompt,
      aiUsed: Boolean(normalizedCommand),
    });
  } catch {
    return noStoreJson({ normalizedCommand: input.prompt, aiUsed: false });
  } finally {
    clearTimeout(timeout);
  }
}
