'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { RESET_PASSWORD_MIN_LENGTH, validateResetPassword } from '@/lib/auth/password-reset';
import { AuthFrame } from '@/components/auth/AuthFrame';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isCheckingLink, setIsCheckingLink] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [passwordUpdatedWithoutGlobalSignOut, setPasswordUpdatedWithoutGlobalSignOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const checkRecoverySession = async () => {
      try {
        const response = await fetch('/api/auth/password-recovery', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!active) return;
        setHasRecoverySession(response.ok);
        if (!response.ok) {
          setError('This reset link is invalid or has expired. Request a new password reset email.');
        }
      } catch {
        if (!active) return;
        setHasRecoverySession(false);
        setError('This reset link is invalid or has expired. Request a new password reset email.');
      } finally {
        if (active) setIsCheckingLink(false);
      }
    };

    void checkRecoverySession();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateResetPassword(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/password-recovery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        passwordUpdated?: boolean;
      } | null;
      if (!response.ok) {
        if (payload?.passwordUpdated) {
          setPasswordUpdatedWithoutGlobalSignOut(true);
          setHasRecoverySession(false);
        }
        throw new Error(payload?.error || 'We could not update your password. Please request a new reset link and try again.');
      }
      setIsComplete(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error
        ? caughtError.message
        : 'We could not update your password. Please request a new reset link and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthFrame>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full"
      >
        <Card className="rounded-2xl border-border bg-card shadow-sm sm:p-2">
          <CardHeader className="space-y-5 pb-7 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-primary">
              {isComplete
                ? <CheckCircle2 className="h-5 w-5" />
                : <Sparkles className="h-5 w-5" />}
            </div>
            <div>
              <CardTitle className="font-display text-3xl font-semibold tracking-tight">
                {isComplete ? 'Password updated' : 'Choose a new password'}
              </CardTitle>
              <CardDescription className="mt-2 text-muted-foreground">
                {isComplete
                  ? 'Your new password is ready to use.'
                  : `Use at least ${RESET_PASSWORD_MIN_LENGTH} characters.`}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            {isComplete ? (
              <Button
                type="button"
                className="h-11 w-full"
                onClick={() => router.replace('/auth/login')}
              >
                Sign in with your new password
              </Button>
            ) : isCheckingLink ? (
              <div role="status" className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-500" />
                Checking your reset link…
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {passwordUpdatedWithoutGlobalSignOut ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => router.replace('/auth/forgot-password')}
                  >
                    Request a new reset link
                  </Button>
                ) : hasRecoverySession ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="new-password">New password</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="new-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={RESET_PASSWORD_MIN_LENGTH}
                          value={password}
                          onChange={(event) => {
                            setPassword(event.target.value);
                            if (error) setError('');
                          }}
                          className="!pl-12"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Confirm new password</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="confirm-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={RESET_PASSWORD_MIN_LENGTH}
                          value={confirmation}
                          onChange={(event) => {
                            setConfirmation(event.target.value);
                            if (error) setError('');
                          }}
                          className="!pl-12"
                          required
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="h-11 w-full"
                    >
                      {isSubmitting
                        ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        : 'Update password'}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => router.replace('/auth/forgot-password')}
                  >
                    Request a new reset link
                  </Button>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </AuthFrame>
  );
}
