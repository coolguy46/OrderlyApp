import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sanitizeAuthRedirectPath, withTimeout } from '@/lib/auth/lifecycle';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeAuthRedirectPath(searchParams.get('next'));

  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await withTimeout(
        supabase.auth.exchangeCodeForSession(code),
        10_000,
        'Sign-in callback',
      );
      if (!error) {
        return NextResponse.redirect(new URL(next, origin));
      }
      console.error('OAuth code exchange failed:', error.message);
    } catch (error) {
      console.error('OAuth callback failed:', error);
    }
  }

  // Return the user to login with an error if code exchange failed
  return NextResponse.redirect(new URL('/auth/login?error=auth_callback_error', origin));
}
