/** Keep provider error bodies, SQL row details, tokens and private URLs out of logs. */
export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown';
  const value = error as { code?: unknown; status?: unknown; name?: unknown };
  if (typeof value.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code)) return value.code;
  if (typeof value.status === 'number' && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599) {
    return `http-${value.status}`;
  }
  if (typeof value.name === 'string' && ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(value.name)) return value.name;
  return 'unknown';
}
