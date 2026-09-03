/** Keep post-auth redirects on this application origin. */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (
    !value
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL('https://orderly.invalid');
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
