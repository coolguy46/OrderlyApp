import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/navigation';
import {
  isPasswordRecoveryExchange,
  PASSWORD_RECOVERY_API_PATH,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_MAX_AGE_SECONDS,
  PASSWORD_RECOVERY_PATH,
} from '@/lib/auth/password-reset';
import {
  createPasswordRecoverySessionToken,
  getPasswordRecoverySigningSecret,
} from '@/lib/auth/password-recovery-token';

function clearSupabaseSessionCookies(response: NextResponse, cookieNames: string[]) {
  for (const name of cookieNames) {
    response.cookies.set(name, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
  return response;
}

async function currentSupabaseSessionCookieNames() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return [];
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const prefix = `sb-${projectRef}-auth-token`;
    return cookieStore.getAll()
      .map(({ name }) => name)
      .filter((name) => name === prefix || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}-`));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeInternalPath(searchParams.get('next'));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // The PKCE exchange identifies recovery links independently of the
      // client-controlled `next` query. Every recovery exchange is forced
      // through the isolated reset flow; changing `next=/` must never turn a
      // recovery link into an ordinary authenticated session.
      const redirectType = (data as typeof data & {
        redirectType?: string | null;
      }).redirectType;
      if (redirectType === 'recovery') {
        const sessionCookieNames = await currentSupabaseSessionCookieNames();

        const signingSecret = getPasswordRecoverySigningSecret();
        const accessToken = data.session?.access_token;
        const refreshToken = data.session?.refresh_token;
        const userVersion = data.user.updated_at || '';
        if (!signingSecret || !accessToken || !refreshToken || !userVersion) {
          console.error('Password recovery signing is not configured');
          return clearSupabaseSessionCookies(
            NextResponse.redirect(`${origin}/auth/login?error=recovery_unavailable`),
            sessionCookieNames,
          );
        }

        const response = NextResponse.redirect(`${origin}${PASSWORD_RECOVERY_PATH}`);
        response.cookies.set(PASSWORD_RECOVERY_COOKIE, createPasswordRecoverySessionToken({
          userId: data.user.id,
          accessToken,
          refreshToken,
          userVersion,
        }, signingSecret), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          // The marker is consumed only by the server-side recovery endpoint.
          // Scoping it there keeps it out of unrelated application requests.
          path: PASSWORD_RECOVERY_API_PATH,
          maxAge: PASSWORD_RECOVERY_MAX_AGE_SECONDS,
        });
        // Do not leave the recovery session in Orderly's normal auth cookie.
        // The encrypted API-scoped capability above is the only place where
        // the short-lived recovery credentials persist.
        return clearSupabaseSessionCookies(response, sessionCookieNames);
      }

      if (next === PASSWORD_RECOVERY_PATH || isPasswordRecoveryExchange(next, redirectType)) {
        return NextResponse.redirect(`${origin}/auth/login?error=invalid_recovery_link`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return the user to login with an error if code exchange failed
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_error`);
}
