/** CSRF defense for cookie-authenticated mutations; authentication still belongs to each route. */
export function guardMutationRequest(request: Request): Response | null {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  let trusted = site !== 'cross-site' && site !== 'same-site';
  if (origin) {
    try {
      trusted &&= new URL(origin).origin === origin && origin === new URL(request.url).origin;
    } catch {
      trusted = false;
    }
  } else if (request.headers.has('cookie') && site !== 'same-origin') {
    // Non-browser callers without cookies can authenticate separately. Cookie
    // callers must supply an exact Origin or browser-controlled Fetch Metadata.
    trusted = false;
  }
  return trusted ? null : Response.json(
    { error: 'This request must come from the Orderly page you are using.' },
    { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export class RequestBodyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestBodyError';
    this.status = status;
  }
}

export function requestBodyErrorResponse(error: unknown): Response | null {
  return error instanceof RequestBodyError
    ? Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } })
    : null;
}

/** Enforce the byte limit while streaming, not after allocating an unbounded body. */
export async function readJsonBody(request: Pick<Request, 'headers' | 'body'>, maxBytes = 131_072): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestBodyError('Send this request as application/json.', 415);
  }
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new RequestBodyError('Request body is too large.', 413);
  }
  if (!request.body) throw new RequestBodyError('Request body must be valid JSON.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
      reject(new RequestBodyError('Request body timed out.', 408));
    }, 10_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (timedOut) throw new RequestBodyError('Request body timed out.', 408);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyError('Request body is too large.', 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new RequestBodyError('Request body must be valid JSON.', 400);
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
