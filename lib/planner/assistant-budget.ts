import { randomUUID } from 'node:crypto';
import type { AssistantUsageRpcClient } from './assistant-usage.ts';
import { MAX_ASSISTANT_PROVIDER_BYTES, readAssistantProviderResponse } from './assistant-provider.ts';
import type { AssistantBillingPeriod } from '../billing/plan.ts';

export class AssistantTokenLimitError extends Error {
  readonly period: 'daily' | 'monthly';
  constructor(period: 'daily' | 'monthly') {
    super(period === 'daily'
      ? 'Your daily AI token allowance is used or this request needs more than remains. It resets at midnight UTC. Manual tools still work.'
      : 'Your monthly AI token allowance is used or this request needs more than remains. It resets at your next billing period. Manual tools still work.');
    this.name = 'AssistantTokenLimitError';
    this.period = period;
  }
}

export class AssistantBudgetError extends Error {
  constructor() {
    super('Assistant safety checks are temporarily unavailable. Your manual planner still works. Please try again later.');
    this.name = 'AssistantBudgetError';
  }
}

interface ProviderBudgetConfiguration {
  model: string;
  dailyMicroUsd: number;
  monthlyMicroUsd: number;
  dailyTokens: number;
  monthlyTokens: number;
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 && number <= 1_000_000_000_000 ? number : null;
}

/** Provider usage is protocol data, not a string-valued environment variable.
 * Coercing malformed responses into valid usage could refund an unknown cost.
 */
function providerTokenInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Exact six-decimal USD conversion; no floating-point under-reservation. */
function usdMicros(value: string | undefined): number | null {
  if (!value || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return positiveInteger(Number(BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, '0'))));
}

export function assistantBudgetConfiguration(environment: NodeJS.ProcessEnv = process.env): ProviderBudgetConfiguration | null {
  const model = environment.DEEPSEEK_BUDGET_MODEL;
  const dailyMicroUsd = usdMicros(environment.AI_PROVIDER_DAILY_BUDGET_USD);
  const monthlyMicroUsd = usdMicros(environment.AI_PROVIDER_MONTHLY_BUDGET_USD);
  const dailyTokens = positiveInteger(environment.AI_PROVIDER_DAILY_TOKEN_LIMIT);
  const monthlyTokens = positiveInteger(environment.AI_PROVIDER_MONTHLY_TOKEN_LIMIT);
  const inputMicroUsdPerMillion = usdMicros(environment.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS);
  const outputMicroUsdPerMillion = usdMicros(environment.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS);
  if (!model || !/^[a-zA-Z0-9._-]{1,120}$/.test(model) || !dailyMicroUsd || !monthlyMicroUsd || !dailyTokens || !monthlyTokens
    || !inputMicroUsdPerMillion || !outputMicroUsdPerMillion || dailyMicroUsd > monthlyMicroUsd || dailyTokens > monthlyTokens) return null;
  return { model, dailyMicroUsd, monthlyMicroUsd, dailyTokens, monthlyTokens, inputMicroUsdPerMillion, outputMicroUsdPerMillion };
}

function estimateCost(prompt: number, completion: number, configuration: ProviderBudgetConfiguration): number {
  return Number((BigInt(prompt) * BigInt(configuration.inputMicroUsdPerMillion)
    + BigInt(completion) * BigInt(configuration.outputMicroUsdPerMillion) + BigInt(999_999)) / BigInt(1_000_000));
}

export function assistantBudgetEnvelope(body: string, configuration: ProviderBudgetConfiguration) {
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_ASSISTANT_PROVIDER_BYTES) throw new AssistantBudgetError();
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssistantBudgetError();
  const record = value as Record<string, unknown>;
  if (record.model !== configuration.model || record.stream !== false || !Array.isArray(record.messages) || !record.messages.length || record.messages.length > 64) throw new AssistantBudgetError();
  if (!record.messages.every(message => message && typeof message === 'object' && typeof message.content === 'string' && ['user', 'assistant', 'system'].includes(message.role))) throw new AssistantBudgetError();
  const completionTokens = positiveInteger(record.max_tokens);
  if (!completionTokens || completionTokens > 8192) throw new AssistantBudgetError();
  // Conservative byte-token bound plus chat-template overhead, not a tokenizer
  // average. Cache hits are priced as uncached input. Model/rates must be
  // explicitly reviewed together; unexpected usage never earns a budget refund.
  const promptTokens = bytes + record.messages.length * 256 + 1024;
  const tokens = promptTokens + completionTokens;
  const microUsd = estimateCost(promptTokens, completionTokens, configuration);
  if (!positiveInteger(microUsd) || !positiveInteger(tokens)) throw new AssistantBudgetError();
  return { promptTokens, completionTokens, tokens, microUsd };
}

async function budgetRpc(client: AssistantUsageRpcClient, name: string, parameters: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // An unconfirmed reservation may have committed. It stays charged; only a
    // confirmed allowed result can dispatch. A late result never dispatches.
    return await Promise.race([
      Promise.resolve(client.rpc(name, parameters)).catch(() => ({ data: null, error: { code: 'unavailable' } })),
      new Promise<{ data: null; error: { code: string } }>(resolve => { timer = setTimeout(() => resolve({ data: null, error: { code: 'timeout' } }), 5_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Every actual model attempt (including a repair) needs a fresh atomic budget
 * reservation. Call only after server auth, subscription and the technical lease.
 * No automatic retries; unknown provider outcomes retain the full reservation.
 */
export async function fetchBudgetedAssistantProvider(
  client: AssistantUsageRpcClient | null,
  verifiedUserId: string,
  leaseId: string,
  body: string,
  options: { apiKey: string; signal: AbortSignal; deadline: number; billingPeriod?: AssistantBillingPeriod; onDispatch?: () => void },
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const configuration = assistantBudgetConfiguration(environment);
  if (!client || !configuration) {
    console.error('Assistant provider safety:', 'configuration_unavailable');
    throw new AssistantBudgetError();
  }
  if (options.signal.aborted || Date.now() >= options.deadline) throw new AssistantBudgetError();
  const envelope = assistantBudgetEnvelope(body, configuration);
  const periodStart = Date.parse(options.billingPeriod?.start || '');
  const periodEnd = Date.parse(options.billingPeriod?.end || '');
  if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodStart > Date.now() || periodEnd <= Date.now()
    || periodEnd <= periodStart || periodEnd - periodStart > 32 * 86400_000) throw new AssistantBudgetError();
  const callId = randomUUID();
  const reserved = await budgetRpc(client, 'assistant_reserve_paid_provider_budget', {
    p_user_id: verifiedUserId, p_lease_id: leaseId, p_call_id: callId,
    p_reserve_micro_usd: envelope.microUsd, p_reserve_tokens: envelope.tokens,
    p_daily_micro_usd: configuration.dailyMicroUsd, p_monthly_micro_usd: configuration.monthlyMicroUsd,
    p_daily_tokens: configuration.dailyTokens, p_monthly_tokens: configuration.monthlyTokens,
    p_billing_period_start: options.billingPeriod!.start, p_billing_period_end: options.billingPeriod!.end,
  });
  if (!reserved.error && (reserved.data === 'daily_limit' || reserved.data === 'monthly_limit')) {
    throw new AssistantTokenLimitError(reserved.data === 'daily_limit' ? 'daily' : 'monthly');
  }
  if (reserved.error || reserved.data !== 'allowed') {
    console.error('Assistant provider safety:', reserved.error ? 'budget_unavailable' : 'budget_denied');
    throw new AssistantBudgetError();
  }
  if (options.signal.aborted || Date.now() >= options.deadline) {
    // We know fetch was never invoked, so this one safe refund is exact.
    await budgetRpc(client, 'assistant_settle_paid_provider_budget', { p_user_id: verifiedUserId, p_call_id: callId, p_actual_micro_usd: 0, p_actual_tokens: 0 });
    throw new AssistantBudgetError();
  }
  options.onDispatch?.();
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body, signal: options.signal, cache: 'no-store', redirect: 'error',
  });
  if (response.ok) {
    try {
      // Bounded reader protects both copies; responses are never logged. A
      // provider error, timeout, absent/invalid usage or accounting outage keeps
      // the full debit. User message accounting is independent of this budget.
      const payload = await readAssistantProviderResponse(response.clone());
      const usage = payload.usage as Record<string, unknown> | undefined;
      const prompt = providerTokenInteger(usage?.prompt_tokens);
      const completion = providerTokenInteger(usage?.completion_tokens);
      const total = providerTokenInteger(usage?.total_tokens);
      if (prompt !== null && prompt > 0 && completion !== null && total !== null && total === prompt + completion
        && prompt <= envelope.promptTokens && completion <= envelope.completionTokens) {
        const settled = await budgetRpc(client, 'assistant_settle_paid_provider_budget', {
          p_user_id: verifiedUserId, p_call_id: callId,
          p_actual_micro_usd: estimateCost(prompt, completion, configuration), p_actual_tokens: total,
        });
        if (settled.error || settled.data !== true) console.error('Assistant provider safety:', 'settlement_unconfirmed');
      } else {
        console.error('Assistant provider safety:', 'usage_unconfirmed_reservation_retained');
      }
    } catch { /* Conservative debit retained; the route handles malformed data. */ }
  }
  return response;
}
