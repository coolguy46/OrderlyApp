import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy } from '@/lib/security/csp';

/** Refresh Supabase cookies and attach the CSP nonce on protected app pages. */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);
  const createResponse = () => NextResponse.next({
    request: { headers: requestHeaders },
  });
  let supabaseResponse = createResponse();

  const withSecurityPolicy = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', contentSecurityPolicy);
    return response;
  };

  // Local UI development still renders without auth configuration. The
  // authenticated client features fail closed through availability checks.
  if (!supabaseUrl || !supabasePublishableKey) {
    return withSecurityPolicy(supabaseResponse);
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = createResponse();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    },
  );

  // Verify modern asymmetric JWTs locally and refresh expired sessions only
  // on authenticated application pages.
  await supabase.auth.getClaims();
  return withSecurityPolicy(supabaseResponse);
}

export const config = {
  matcher: [
    '/',
    '/calendar/:path*',
    '/exams/:path*',
    '/goals/:path*',
    '/planner/:path*',
    '/profile/:path*',
    '/settings/:path*',
    '/study/:path*',
    '/tasks/:path*',
    '/setup/:path*',
  ],
};
