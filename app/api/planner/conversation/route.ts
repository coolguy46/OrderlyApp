import { NextRequest, NextResponse } from 'next/server';
import { CalendarCapacityError } from '@/lib/planner/calendar-range';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { conversationSystemPrompt, parseConversationIntent, readConversationRequest, type ConversationIntent, type ConversationResult } from '@/lib/planner/conversation';
import { calendarFromSnapshot, compileConversation, conversationFacts, conversationValidationFeedback, type ConversationSnapshot } from '@/lib/planner/conversation-calendar';
import { completeAssistantUsage, failAssistantUsage, parseAssistantProviderUsage, reserveAssistantUsage, type AssistantUsageRpcClient } from '@/lib/planner/assistant-usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const windows = new Map<string, { start: number; count: number }>();
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ reply: 'Sign in to use Orderly Assistant.', saved: false }, 401);
  let input;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 96 * 1024) return json({ reply: 'That conversation is too long to send.', saved: false }, 413);
    input = readConversationRequest(JSON.parse(body));
  } catch {
    return json({ reply: 'I could not read that message. Please try again.', saved: false }, 400);
  }
  const rpc = supabase as unknown as AssistantUsageRpcClient;
  // This receipt check precedes quotas and the provider. Network retries cost
  // nothing and cannot replay a successful calendar operation.
  const receiptsTable = supabase.from('assistant_action_receipts');
  const prior = await receiptsTable.select('response').eq('user_id', user.id).eq('request_id', input.requestId).maybeSingle();
  if (prior.error) return json({ reply: 'The Assistant update needs its database migration before chat can save safely. No changes were made.', saved: false }, 503);
  if (prior.data) return json((prior.data as { response: unknown }).response);
  const now = Date.now();
  const recent = windows.get(user.id);
  const configured = Number(process.env.DEEPSEEK_REQUESTS_PER_MINUTE);
  const limit = configured > 0 ? Math.min(60, Math.floor(configured)) : 6;
  if (recent && now - recent.start < 60_000 && recent.count >= limit) return json({ reply: 'You are sending messages too quickly. Wait a moment and try again.', saved: false }, 429);
  windows.set(user.id, recent && now - recent.start < 60_000 ? { ...recent, count: recent.count + 1 } : { start: now, count: 1 });
  // Bound the in-memory convenience limiter; durable quotas remain in Supabase.
  for (const [id, window] of windows) if (now - window.start > 60_000) windows.delete(id);
  const snapshotResult = await rpc.rpc('assistant_calendar_snapshot', {});
  if (snapshotResult.error) return json({ reply: 'I could not load your current calendar, so I made no changes. Try again shortly.', saved: false }, 503);
  const snapshot = snapshotResult.data as ConversationSnapshot;
  let saveAttempted = false;
  const persist = async (operations: unknown[], response: unknown, revision = snapshot.revision) => {
    saveAttempted = true;
    const result = await rpc.rpc('apply_assistant_calendar_changes', {
      p_request_id: input.requestId, p_conversation_id: input.conversationId,
      p_revision: revision, p_operations: operations, p_response: response,
    });
    if (result.error) throw new Error(result.error.message || 'Save failed');
    return result.data as ConversationResult;
  };
  if (input.undoRequestId) {
    const original = await receiptsTable.select('response').eq('user_id', user.id).eq('conversation_id', input.conversationId).eq('request_id', input.undoRequestId).maybeSingle();
    const saved = (original.data as { response: ConversationResult } | null)?.response;
    if (!saved?.saved || !saved.undoOperations?.length) return json({ reply: 'There is no saved change to undo.', saved: false }, 400);
    try {
      return json(await persist(saved.undoOperations, { reply: 'Undid that calendar change.', intent: null, items: [], undoneRequestId: input.undoRequestId }, saved.revision));
    } catch {
      return json({ reply: 'Your calendar changed since that action. I left the newer changes alone. Tell me which item to adjust instead.', saved: false }, 409);
    }
  }
  if (process.env.AI_ASSISTANT_ENABLED === 'false' || !process.env.DEEPSEEK_API_KEY) return json({ reply: 'Orderly Assistant is temporarily unavailable. Your calendar still works.', saved: false }, 503);
  const reservation = await reserveAssistantUsage(rpc, input.requestId);
  if (reservation.error) return json({ reply: 'I could not start usage tracking. No changes were made.', saved: false }, 503);
  if (!reservation.reservation?.allowed) return json({ reply: 'This request may still be processing, or your configured chat allowance is reached. Retry the same message in a moment to check its saved result.', saved: false }, 409);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 45_000);
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let dispatched = false;
  let usageFinalized = false;
  try {
    const history = await receiptsTable.select('response,created_at').eq('user_id', user.id).eq('conversation_id', input.conversationId).order('created_at', { ascending: false }).limit(12);
    if (history.error) throw new Error('I could not load confirmed conversation results. No changes were made.');
    const receipts = (history.data || []).map(row => {
      const response = row.response as unknown as ConversationResult;
      const { undoOperations: _undo, revision: _revision, ...memory } = response;
      void _undo; void _revision;
      return memory;
    }).reverse();
    const calendar = calendarFromSnapshot(snapshot, user.id, new Date().toISOString(), input.timeZone);
    calendar.localBusy = input.localBusy;
    calendar.localEvents = input.localEvents;
    const providerMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: conversationSystemPrompt({ ...conversationFacts(calendar, receipts), selectedDate: input.selectedDate || null }) },
      ...input.messages,
    ];
    let intent: ConversationIntent | null = null;
    let compiled: ReturnType<typeof compileConversation> | null = null;
    let lastProblem = '';
    // One optional read-only range lookup and one repair. Never invoke
    // the phrase-matching normalizer on this conversational path.
    let inspected = false;
    let repairs = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (controller.signal.aborted) throw new Error('That response was stopped before saving.');
      dispatched = true;
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: providerMessages, temperature: 0, max_tokens: 1800, stream: false, response_format: { type: 'json_object' }, thinking: { type: 'disabled' } }),
        signal: controller.signal, cache: 'no-store',
      });
      if (!response.ok) throw new Error('I could not reach the AI service. No changes were made.');
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
      const used = parseAssistantProviderUsage(payload.usage);
      usage.promptTokens += used.promptTokens; usage.completionTokens += used.completionTokens; usage.totalTokens += used.totalTokens;
      const raw = payload.choices?.[0]?.message?.content || '';
      try {
        intent = parseConversationIntent(raw);
        if (intent.mode === 'inspect') {
          if (inspected) throw new Error('The one calendar lookup was already used. Answer from the returned range or explain what additional range is needed.');
          inspected = true;
          const facts = conversationFacts(calendar, [], intent.calendarRange);
          providerMessages.push({ role: 'assistant', content: raw }, { role: 'system', content: `Read-only calendar lookup completed. No changes were saved. Use these facts to answer the original request, now returning discuss, clarify, act, or plan:\n${JSON.stringify({ calendarRange: facts.calendarRange, calendar: facts.calendar })}` });
          intent = null;
          continue;
        }
        compiled = compileConversation(intent, calendar);
        break;
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : 'The proposed operation was invalid.';
        intent = null;
        compiled = null;
        if (repairs++ >= 1) break;
        providerMessages.push({ role: 'assistant', content: raw }, { role: 'system', content: `Validation feedback (no changes have saved): ${conversationValidationFeedback(error)}\nRepair the structured response using the real snapshot and the user's original intent. If this is a genuine constraint or ambiguity, return clarify with one useful question and no operations. Do not change explicitly requested times just to pass validation.` });
      }
    }
    await completeAssistantUsage(rpc, input.requestId, usage, model);
    usageFinalized = true;
    if (controller.signal.aborted) throw new Error('That response was stopped before saving.');
    if (!compiled || !intent) {
      return json(await persist([], { reply: `I couldn't safely apply that yet. ${lastProblem} No changes were saved.`, intent: null, items: [] }));
    }
    const result = await persist(compiled.writes, {
      reply: compiled.reply, intent, items: compiled.items,
      userMessage: input.messages.at(-1)!.content,
    });
    return json(result);
  } catch (error) {
    if (!usageFinalized) {
      if (dispatched) await completeAssistantUsage(rpc, input.requestId, usage, model);
      else await failAssistantUsage(rpc, input.requestId);
    }
    const message = error instanceof Error ? error.message : 'The request could not finish.';
    if (!saveAttempted || message.includes('CALENDAR_CHANGED')) {
      try {
        return json(await persist([], { reply: message.includes('CALENDAR_CHANGED')
          ? 'Your calendar changed while I was planning. I left the new edits alone and saved nothing from this request. Ask me to try again with the updated calendar.'
          : error instanceof CalendarCapacityError ? message : 'I could not finish that response. No calendar changes were made. Please try again.', intent: null, items: [] }));
      } catch { /* Keep the request ID for receipt recovery. */ }
    }
    // A database response can be lost AFTER commit. Do not declare rollback or
    // rerun the model: the client keeps the same request ID to recover receipt.
    return json({ reply: message.includes('CALENDAR_CHANGED')
      ? 'Your calendar changed while I was planning. No changes from this request were applied. Send the request again so I can use the latest schedule.'
      : 'I could not confirm the result. Retry this message to check its saved status before creating anything again.', saved: false, retryable: true }, 503);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
  }
}
