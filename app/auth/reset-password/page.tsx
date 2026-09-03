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
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-indigo-500/10">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md"
      >
        <Card className="border-border/50 bg-card/80 backdrop-blur-xl">
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
              {isComplete
                ? <CheckCircle2 className="h-6 w-6 text-white" />
                : <Sparkles className="h-6 w-6 text-white" />}
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">
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
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
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
                    className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300"
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
                      className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
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
    </div>
  );
}
