import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  PLANNER_INTERPRET_SYSTEM_PROMPT,
  buildDeterministicPlannerInterpretation,
  buildPlannerInterpretUserPrompt,
  parsePlannerAIJson,
  sanitizePlannerInterpretInput,
  validateAIPlannerInterpretation,
} from '@/lib/planner/intent';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = sanitizePlannerInterpretInput(body);
  const fallback = buildDeterministicPlannerInterpretation(input);
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return NextResponse.json(fallback);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

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
          { role: 'system', content: PLANNER_INTERPRET_SYSTEM_PROMPT },
          { role: 'user', content: buildPlannerInterpretUserPrompt(input) },
        ],
        temperature: 0,
        stream: false,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(fallback);
    }

    const payload = await response.json() as DeepSeekResponse;
    const parsed = parsePlannerAIJson(payload.choices?.[0]?.message?.content);
    return NextResponse.json(validateAIPlannerInterpretation(parsed, input, fallback));
  } catch {
    return NextResponse.json(fallback);
  } finally {
    clearTimeout(timeout);
  }
}
