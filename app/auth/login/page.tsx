'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/separator';
import { Mail, Lock, ArrowRight, Chrome, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { signInWithGoogle } from '@/lib/supabase/services';
import { errorMessage } from '@/lib/auth/lifecycle';
import { useHydrated } from '@/lib/use-hydrated';

function callbackErrorMessage(value: string | null): string {
  if (value === 'auth_callback_error') {
    return 'Sign-in could not be completed. Please try again.';
  }
  if (value === 'recovery_unavailable') {
    return 'Password recovery is temporarily unavailable. Please request a new link later.';
  }
  if (value === 'invalid_recovery_link') {
    return 'That password recovery link is invalid or expired. Please request a new one.';
  }
  return '';
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const hydrated = useHydrated();
  const authResult = hydrated ? new URLSearchParams(window.location.search) : null;
  const queryError = callbackErrorMessage(authResult?.get('error') ?? null);
  const notice = authResult?.get('accountDeleted') === '1'
    ? 'Your Orderly account and stored data were deleted.'
    : '';
  const displayedError = error || queryError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      const success = await login(email, password);
      if (success) {
        router.replace('/');
      } else {
        setError('Invalid email or password');
      }
    } catch (err) {
      setError(errorMessage(err, 'An error occurred. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(errorMessage(err, 'Google sign-in failed. Please try again.'));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-indigo-500/10">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative"
      >
        <Card className="border-border/50 bg-card/80 backdrop-blur-xl">
          <CardHeader className="text-center space-y-4">
            {/* Logo */}
            <div className="mx-auto w-12 h-12 rounded-xl flex items-center justify-center">
              <Image src="/logo.svg" alt="Orderly Logo" width={48} height={48} className="w-12 h-12" priority />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
              <CardDescription className="text-muted-foreground">
                Sign in to continue to Orderly
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Social Login Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="w-full col-span-2"
              >
                <Chrome className="w-4 h-4" />
                Continue with Google
              </Button>
            </div>

            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                or continue with
              </span>
            </div>

            {displayedError && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{displayedError}</span>
              </div>
            )}

            {notice && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-300"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError('');
                    }}
                    className="!pl-12"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError('');
                    }}
                    className="!pl-12"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link
                href="/auth/register"
                className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                Sign up
              </Link>
            </p>
          </CardFooter>
        </Card>

        {/* Terms */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-foreground transition-colors">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
