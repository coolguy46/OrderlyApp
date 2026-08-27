'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ListChecks,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase/client';

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Canvas stays current',
    description: 'Assignments, classes, descriptions, and exact due times stay synced in the background.',
  },
  {
    icon: ListChecks,
    title: 'One clear task list',
    description: 'See what is active, completed, or missing without digging through different school pages.',
  },
  {
    icon: CalendarClock,
    title: 'Plan time your way',
    description: 'Keep work untimed or drag it into an hour-by-hour week that works around your commitments.',
  },
] as const;

export default function LandingPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(Boolean(data.user));
    });
  }, []);

  const primaryHref = isLoggedIn ? '/' : '/auth/register';
  const primaryLabel = isLoggedIn ? 'Open dashboard' : 'Get started';

  return (
    <div className="min-h-screen overflow-hidden bg-[#070812] text-white">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[-22rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute bottom-[-18rem] right-[-12rem] h-[32rem] w-[32rem] rounded-full bg-purple-600/10 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-white/10 bg-[#070812]/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8" aria-label="Main navigation">
          <Link href="/landing" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            <Image src="/logo.svg" alt="" width={43} height={38} className="h-[38px] w-auto rounded-xl" priority />
            <span className="hidden text-lg font-semibold tracking-tight sm:inline">Orderly</span>
          </Link>

          <div className="flex items-center gap-2">
            {!isLoggedIn && (
              <Button asChild variant="ghost" className="text-white/75 hover:bg-white/5 hover:text-white">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            )}
            <Button asChild className="bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-400">
              <Link href={primaryHref}>
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1.5 text-sm text-indigo-200">
              <CheckCircle2 className="h-4 w-4" />
              Tasks, Canvas, and your schedule in one place
            </div>
            <h1 className="font-display text-5xl font-bold leading-[1.03] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              Know what&apos;s due.
              <span className="block bg-gradient-to-r from-indigo-300 via-violet-300 to-purple-400 bg-clip-text text-transparent">
                Plan when you&apos;ll do it.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/60 sm:text-xl">
              Orderly keeps schoolwork organized, preserves exact deadlines, and gives you a flexible week you can adjust yourself.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-indigo-500 px-7 text-white shadow-xl shadow-indigo-500/25 hover:bg-indigo-400">
                <Link href={primaryHref}>
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {!isLoggedIn && (
                <span className="text-sm text-white/60">Free to use.</span>
              )}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-lg" role="img" aria-label="Orderly schedule preview">
            <div className="absolute -inset-8 rounded-[2.5rem] bg-indigo-500/10 blur-3xl" aria-hidden="true" />
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d101c]/90 p-4 shadow-2xl shadow-black/40 sm:p-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-sm font-semibold">Today</p>
                  <p className="mt-0.5 text-xs text-white/55">Tasks and planned time</p>
                </div>
                <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-white/50">Wednesday</span>
              </div>

              <div className="space-y-2 py-4">
                <PreviewTask title="English essay" detail="Due today · 3:00 PM" tone="red" />
                <PreviewTask title="Statistics practice" detail="Due tomorrow · 11:59 PM" tone="amber" />
              </div>

              <div className="grid grid-cols-[3.5rem_1fr] gap-x-3 border-t border-white/10 pt-4 text-xs">
                <TimeLabel>6 PM</TimeLabel>
                <ScheduleBlock title="Workout" time="6:00–7:00 PM" className="border-cyan-400/25 bg-cyan-400/10 text-cyan-100" />
                <TimeLabel>7 PM</TimeLabel>
                <ScheduleBlock title="English essay" time="7:15–8:15 PM" className="border-indigo-400/30 bg-indigo-400/15 text-indigo-100" />
                <TimeLabel>8 PM</TimeLabel>
                <div className="h-10 border-t border-white/5" />
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-white/[0.015] px-5 py-20 sm:px-8" aria-labelledby="features-title">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-300">Built for real school weeks</p>
              <h2 id="features-title" className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                The essentials, without the clutter.
              </h2>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-400/10 text-indigo-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/60">{description}</p>
                </article>
              ))}
            </div>

            <p className="mt-8 text-sm text-white/60">
              Goals, exams, and a focus timer are available when you need them.
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Orderly</p>
          <div className="flex gap-5">
            <Link href="/privacy" className="text-white/70 transition-colors hover:text-white">Privacy</Link>
            <Link href="/terms" className="text-white/70 transition-colors hover:text-white">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PreviewTask({ title, detail, tone }: { title: string; detail: string; tone: 'red' | 'amber' }) {
  const toneClass = tone === 'red'
    ? 'border-red-400/20 bg-red-400/5 text-red-300'
    : 'border-amber-400/20 bg-amber-400/5 text-amber-300';

  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl border px-3.5 py-3 ${toneClass}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-4 w-4 shrink-0 rounded-full border border-current/60" />
        <p className="truncate text-sm font-medium text-white/85">{title}</p>
      </div>
      <p className="shrink-0 text-[11px]">{detail}</p>
    </div>
  );
}

function TimeLabel({ children }: { children: ReactNode }) {
  return <div className="border-t border-white/5 py-2 text-right text-white/30">{children}</div>;
}

function ScheduleBlock({ title, time, className }: { title: string; time: string; className: string }) {
  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${className}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 opacity-60">{time}</p>
    </div>
  );
}
