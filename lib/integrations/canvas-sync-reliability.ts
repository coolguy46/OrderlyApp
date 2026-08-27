export const CANVAS_CONNECT_DEADLINE_MS = 20_000;
export const CANVAS_MANUAL_SYNC_SERVER_DEADLINE_MS = 45_000;
// Leave enough time for a large successful assignment payload—or the server's
// small 504 response—to reach the browser before its own safety cutoff.
export const CANVAS_MANUAL_SYNC_CLIENT_DEADLINE_MS = 55_000;

export const CANVAS_CONNECT_TIMEOUT_MESSAGE =
  'Connecting to Canvas took too long. Check your connection and try again.';
export const CANVAS_SYNC_TIMEOUT_MESSAGE =
  'Canvas sync took too long. Wait a minute, then try again. Any assignments already imported were kept.';

export class CanvasOperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasOperationTimeoutError';
  }
}

/**
 * Bounds an operation and exposes a signal so callers can cancel underlying
 * work when the API supports it. Promise.race keeps the caller responsive even
 * when a third-party client ignores that signal.
 */
export async function withCanvasDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Canvas operation timeout must be a positive number');
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new CanvasOperationTimeoutError(timeoutMessage);
      // Settle the deadline first so an abort-aware operation cannot replace
      // the actionable timeout with a generic AbortError.
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });
  const runningOperation = Promise.resolve().then(() => operation(controller.signal));

  try {
    return await Promise.race([runningOperation, deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

interface CanvasSyncResponsePayload extends Record<string, unknown> {
  assignments: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fallbackHttpError(status: number): string {
  if (status === 401) {
    return 'Your session expired. Sign in again, then retry the Canvas sync.';
  }
  if (status === 408 || status === 504) return CANVAS_SYNC_TIMEOUT_MESSAGE;
  if (status === 429) {
    return 'Canvas sync is busy right now. Wait a minute, then try again.';
  }
  if (status >= 500) {
    return 'Canvas sync is temporarily unavailable. Please try again in a minute.';
  }
  return 'Canvas could not be synced. Check the calendar feed and try again.';
}

/**
 * Reads an internal sync response without assuming that hosting/proxy errors
 * are JSON. Successful responses must contain the assignments array consumed
 * by the client.
 */
export async function readCanvasSyncResponse(
  response: Response
): Promise<CanvasSyncResponsePayload> {
  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch {
    throw new Error('Canvas sync returned an unreadable response. Please try again.');
  }

  let parsed: unknown = null;
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      if (!response.ok) throw new Error(fallbackHttpError(response.status));
      throw new Error('Canvas sync returned an invalid response. Please try again.');
    }
  }

  if (!response.ok) {
    const serverMessage = isRecord(parsed) && typeof parsed.error === 'string'
      ? parsed.error.trim()
      : '';
    throw new Error(serverMessage || fallbackHttpError(response.status));
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.assignments)) {
    throw new Error('Canvas sync returned an incomplete response. Please try again.');
  }

  return parsed as CanvasSyncResponsePayload;
}
