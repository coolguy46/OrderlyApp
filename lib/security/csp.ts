export function configuredSupabaseConnectSources(value: string | undefined): string[] {
  if (!value) return [];

  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return [];
    }

    const httpOrigin = url.origin;
    const socketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return [httpOrigin, `${socketProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(options: {
  nonce: string;
  nodeEnv: string | undefined;
  supabaseUrl: string | undefined;
}): string {
  const isDevelopment = options.nodeEnv === 'development';
  const connectSources = [
    "'self'",
    ...configuredSupabaseConnectSources(options.supabaseUrl),
  ];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `style-src 'self'${isDevelopment ? " 'unsafe-inline'" : ` 'nonce-${options.nonce}'`}`,
    // React animation/layout libraries use element style attributes. Keeping
    // that permission separate preserves a strict nonce-only policy for style
    // elements and, most importantly, removes unsafe inline scripts.
    "style-src-attr 'unsafe-inline'",
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (!isDevelopment) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
