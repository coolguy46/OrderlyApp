export type CanvasProviderRequestKind = 'validate' | 'manual_sync';

export interface CanvasProviderRequestClaim {
  token: string | null;
  retryAfterSeconds: number;
}

function firstRow(payload: unknown): unknown {
  return Array.isArray(payload) ? payload[0] ?? null : payload;
}

/**
 * Parse the table-valued response from claim_canvas_provider_request.
 *
 * A null token is an intentional denial and always carries a positive retry
 * delay. Malformed responses fail closed instead of allowing an uncoordinated
 * request to Canvas.
 */
export function parseCanvasProviderRequestClaim(
  payload: unknown,
): CanvasProviderRequestClaim {
  const value = firstRow(payload);
  if (!value || typeof value !== 'object') {
    throw new Error('Canvas provider request claim response was invalid');
  }

  const record = value as Record<string, unknown>;
  const rawToken = record.claim_token;
  const rawRetryAfter = Number(record.retry_after_seconds);
  const token = rawToken === null ? null : rawToken;

  if (
    (token !== null && (typeof token !== 'string' || token.length === 0))
    || !Number.isInteger(rawRetryAfter)
    || rawRetryAfter < 0
    || (token === null && rawRetryAfter < 1)
    || (token !== null && rawRetryAfter !== 0)
  ) {
    throw new Error('Canvas provider request claim response was invalid');
  }

  return { token, retryAfterSeconds: rawRetryAfter };
}

export function isCanvasProviderThrottleMigrationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string'
    ? record.message.toLowerCase()
    : '';

  if (code === 'PGRST202' || code === '42883' || code === '42P01' || code === '42703') {
    return true;
  }

  return message.includes('claim_canvas_provider_request')
    || message.includes('release_canvas_provider_request')
    || message.includes('canvas_provider_request_limits')
    || message.includes('course_count');
}
