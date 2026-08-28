export const DEFAULT_ASSISTANT_DAILY_LIMIT = 10;
export const DEFAULT_ASSISTANT_MONTHLY_LIMIT = 100;

export interface AssistantUsageRemaining {
  remainingDaily: number;
  remainingMonthly: number;
}

export interface AssistantUsageReservation {
  allowed: boolean;
  requestId: string;
  usage: AssistantUsageRemaining;
}

export interface AssistantProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface RpcError {
  code?: string;
  message?: string;
}

interface RpcResult {
  data: unknown;
  error: RpcError | null;
}

export interface AssistantUsageRpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface AssistantUsageAttempt {
  reservation: AssistantUsageReservation | null;
  error: 'unavailable' | null;
}

function boundedLimit(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, Math.floor(parsed))
    : fallback;
}

export function getAssistantUsageLimits(environment: NodeJS.ProcessEnv = process.env) {
  return {
    daily: boundedLimit(environment.DEEPSEEK_DAILY_MESSAGE_LIMIT, DEFAULT_ASSISTANT_DAILY_LIMIT, 1_000),
    monthly: boundedLimit(
      environment.DEEPSEEK_MONTHLY_MESSAGE_LIMIT,
      DEFAULT_ASSISTANT_MONTHLY_LIMIT,
      20_000,
    ),
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function parseAssistantProviderUsage(value: unknown): AssistantProviderUsage {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const promptTokens = nonNegativeInteger(record.prompt_tokens) || 0;
  const completionTokens = nonNegativeInteger(record.completion_tokens) || 0;
  const reportedTotal = nonNegativeInteger(record.total_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal === null
      ? promptTokens + completionTokens
      : Math.max(reportedTotal, promptTokens + completionTokens),
  };
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

export function parseAssistantUsageReservation(
  value: unknown,
  requestId: string,
): AssistantUsageReservation | null {
  const record = firstRecord(value);
  if (!record || typeof record.allowed !== 'boolean') return null;
  const dailyUsed = nonNegativeInteger(record.daily_used);
  const monthlyUsed = nonNegativeInteger(record.monthly_used);
  const dailyLimit = nonNegativeInteger(record.daily_limit);
  const monthlyLimit = nonNegativeInteger(record.monthly_limit);
  if (dailyUsed === null || monthlyUsed === null || dailyLimit === null || monthlyLimit === null) {
    return null;
  }
  return {
    allowed: record.allowed,
    requestId,
    usage: {
      remainingDaily: Math.max(0, dailyLimit - dailyUsed),
      remainingMonthly: Math.max(0, monthlyLimit - monthlyUsed),
    },
  };
}

export async function reserveAssistantUsage(
  client: AssistantUsageRpcClient,
  requestId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<AssistantUsageAttempt> {
  const limits = getAssistantUsageLimits(environment);
  const { data, error } = await client.rpc('assistant_reserve_ai_request', {
    p_request_id: requestId,
    p_daily_limit: limits.daily,
    p_monthly_limit: limits.monthly,
  });
  if (error) {
    console.error('Assistant quota reservation failed:', error.code || error.message || 'unknown error');
    return { reservation: null, error: 'unavailable' };
  }
  const reservation = parseAssistantUsageReservation(data, requestId);
  return reservation
    ? { reservation, error: null }
    : { reservation: null, error: 'unavailable' };
}

export async function completeAssistantUsage(
  client: AssistantUsageRpcClient,
  requestId: string,
  providerUsage: AssistantProviderUsage,
  model: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('assistant_complete_ai_request', {
    p_request_id: requestId,
    p_prompt_tokens: providerUsage.promptTokens,
    p_completion_tokens: providerUsage.completionTokens,
    p_total_tokens: providerUsage.totalTokens,
    p_model: model,
  });
  if (error) {
    console.error('Assistant usage completion failed:', error.code || error.message || 'unknown error');
    return false;
  }
  if (data !== true) {
    console.error('Assistant usage completion failed: RPC did not confirm the update');
    return false;
  }
  return true;
}

export async function failAssistantUsage(
  client: AssistantUsageRpcClient,
  requestId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('assistant_fail_ai_request', {
    p_request_id: requestId,
  });
  if (error) {
    console.error('Assistant usage failure marker failed:', error.code || error.message || 'unknown error');
    return false;
  }
  if (data !== true) {
    console.error('Assistant usage failure marker failed: RPC did not confirm the update');
    return false;
  }
  return true;
}

export function restoreFailedReservationUsage(
  usage: AssistantUsageRemaining,
  environment: NodeJS.ProcessEnv = process.env,
): AssistantUsageRemaining {
  const limits = getAssistantUsageLimits(environment);
  return {
    remainingDaily: Math.min(limits.daily, usage.remainingDaily + 1),
    remainingMonthly: Math.min(limits.monthly, usage.remainingMonthly + 1),
  };
}
