/** Only a definite server rejection can release the exactly-once request ID.
 * HTTP 409 also represents an active request, so its status alone is not enough.
 */
export function isConfirmedConversationRejection(value: unknown): value is { reply: string; saved: false } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.reply === 'string' && result.reply.trim().length > 0
    && result.saved === false && result.retryable !== true;
}
