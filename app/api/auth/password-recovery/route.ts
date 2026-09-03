import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_API_PATH,
  validateResetPassword,
} from '@/lib/auth/password-reset';
import type { Database } from '@/lib/supabase/types';
import {
  getPasswordRecoverySigningSecret,
  readPasswordRecoverySessionToken,
} from '@/lib/auth/password-recovery-token';

export const dynamic = 'force-dynamic';

function clearRecoveryCookie(response: NextResponse) {
  response.cookies.set(PASSWORD_RECOVERY_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: PASSWORD_RECOVERY_API_PATH,
    maxAge: 0,
  });
  return response;
}

async function getAuthorizedRecoveryUser(request: NextRequest) {
  const marker = request.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value;
  const signingSecret = getPasswordRecoverySigningSecret();
  if (!marker || !signingSecret) return null;

  const recoverySession = readPasswordRecoverySessionToken(marker, signingSecret);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!recoverySession || !supabaseUrl || !supabasePublishableKey) return null;

  // This server-only client stores the recovery session in memory. It never
  // writes an ordinary browser auth cookie and therefore cannot unlock the
  // rest of the application during password recovery.
  const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data: { user }, error } = await supabase.auth.setSession({
    access_token: recoverySession.accessToken,
    refresh_token: recoverySession.refreshToken,
  });
  if (
    error
    || !user
    || user.id !== recoverySession.userId
    || !user.updated_at
    || user.updated_at !== recoverySession.userVersion
  ) return null;
  return { supabase, user };
}

export async function GET(request: NextRequest) {
  try {
    const recovery = await getAuthorizedRecoveryUser(request);
    if (!recovery) {
      return clearRecoveryCookie(NextResponse.json({ valid: false }, { status: 401 }));
    }
    return NextResponse.json(
      { valid: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ valid: false }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const recovery = await getAuthorizedRecoveryUser(request);
    if (!recovery) {
      return clearRecoveryCookie(NextResponse.json(
        { error: 'This reset link is invalid or has expired. Request a new password reset email.' },
        { status: 401 },
      ));
    }

    const body = await request.json().catch(() => null) as {
      password?: unknown;
      confirmation?: unknown;
    } | null;
    const password = typeof body?.password === 'string' ? body.password : '';
    const confirmation = typeof body?.confirmation === 'string' ? body.confirmation : '';
    const validationError = validateResetPassword(password, confirmation);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { error } = await recovery.supabase.auth.updateUser({ password });
    if (error) {
      return NextResponse.json(
        { error: 'We could not update your password. Please request a new reset link and try again.' },
        { status: 400 },
      );
    }

    // Invalidate the recovery session after the password changes. The encrypted,
    // authenticated capability also binds the prior user revision, so it cannot
    // authorize a replay if a client ignores the Set-Cookie deletion response.
    const { error: signOutError } = await recovery.supabase.auth.signOut({ scope: 'global' });
    if (signOutError) {
      console.error('Password changed but global session revocation failed');
      return clearRecoveryCookie(NextResponse.json(
        {
          error: 'Your password changed, but we could not sign out every other session. Request a new reset link and try again when the service is available.',
          passwordUpdated: true,
        },
        { status: 503 },
      ));
    }

    return clearRecoveryCookie(NextResponse.json({ success: true }));
  } catch {
    return NextResponse.json(
      { error: 'Password reset is temporarily unavailable. Please try again later.' },
      { status: 503 },
    );
  }
}
