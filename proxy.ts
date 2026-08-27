import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresh Supabase cookies only on authenticated application pages.
 *
 * Public marketing/auth pages and API routes do their own authentication and
 * must not pay for a networked auth lookup before they can render or respond.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // getClaims verifies modern asymmetric Supabase JWTs locally and refreshes
  // expired cookie sessions when necessary. It avoids an unconditional Auth
  // server round trip on every protected navigation.
  await supabase.auth.getClaims();

  return supabaseResponse;
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
