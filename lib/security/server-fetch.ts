/** Bounded server transport. Never follow redirects carrying privileged headers. */
export function createDeadlineFetch(deadline = Number.POSITIVE_INFINITY, timeoutMs = 10_000, transport: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const remaining = Math.min(timeoutMs, deadline - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) return Promise.reject(new Error('Server request deadline exceeded'));
    const signals = [AbortSignal.timeout(Math.ceil(remaining))];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);
    if (signal.aborted) return Promise.reject(signal.reason);
    return transport(input, { ...init, signal, redirect: 'error' });
  };
}
