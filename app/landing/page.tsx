import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CalendarDays, ListTodo, Target } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Orderly | Plan school without the chaos',
  description: 'Keep assignments, schedules, study sessions, exams, and goals in one clear place.',
};

const highlights = [
  {
    icon: ListTodo,
    title: 'Tasks',
    description: 'Keep assignments and deadlines together.',
  },
  {
    icon: CalendarDays,
    title: 'Schedule',
    description: 'Turn what is due into a clear plan for the week.',
  },
  {
    icon: Target,
    title: 'Progress',
    description: 'Track study sessions, exams, and goals as you go.',
  },
];

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[-18rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-indigo-500/12 blur-3xl" />
        <div className="absolute bottom-[-20rem] right-[-12rem] h-[32rem] w-[32rem] rounded-full bg-purple-500/10 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-border/60">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8"
        >
          <Link href="/landing" className="flex items-center gap-2.5 rounded-lg font-display font-bold tracking-tight">
            <Image src="/logo.svg" alt="" width={36} height={36} className="rounded-lg" priority />
            <span className="text-lg">Orderly</span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm hover:from-indigo-600 hover:to-purple-700"
            >
              <Link href="/auth/register">Get started</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 items-center px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-3xl">
            <p className="mb-5 inline-flex rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-sm font-medium text-indigo-600 dark:text-indigo-300">
              A calmer way to manage school
            </p>
            <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-7xl lg:text-8xl">
              Know what to do next.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Orderly brings your assignments, schedule, and study plans into one clear place—so you can spend less time organizing and more time getting things done.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 bg-gradient-to-r from-indigo-500 to-purple-600 px-7 text-base text-white shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-purple-700"
              >
                <Link href="/auth/register">
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-7 text-base">
                <Link href="/auth/login">I already have an account</Link>
              </Button>
            </div>
          </div>

          <section aria-label="What Orderly helps with" className="mt-16 border-t border-border/70 pt-7 sm:mt-24">
            <div className="grid gap-3 sm:grid-cols-3 sm:gap-6">
              {highlights.map((highlight) => (
                <div key={highlight.title} className="flex gap-3 rounded-2xl border border-border/60 bg-card/55 p-4 backdrop-blur-sm sm:border-0 sm:bg-transparent sm:p-0">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                    <highlight.icon className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold">{highlight.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{highlight.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/60 px-5 py-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>Orderly</span>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
