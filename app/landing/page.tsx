'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Circle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase/client';

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
    <div className="workspace-shell flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-5 sm:px-10" aria-label="Main navigation">
          <Link href="/landing" aria-label="Orderly home" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Image src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9 rounded-lg" priority />
            <span className="hidden text-xl font-semibold tracking-tight min-[380px]:inline">Orderly<span className="text-primary">.</span></span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            {!isLoggedIn && <Button asChild variant="ghost" className="px-3 text-muted-foreground"><Link href="/auth/login">Sign in</Link></Button>}
            <Button asChild className="px-3 sm:px-5"><Link href={primaryHref}>{primaryLabel}<ArrowRight className="h-4 w-4" /></Link></Button>
          </div>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-5 py-14 sm:px-10 sm:py-20">
        <section className="grid w-full items-center gap-12 lg:grid-cols-[1.03fr_1fr] lg:gap-20" aria-labelledby="landing-title">
          <div className="max-w-xl">
            <p className="mb-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Your student workspace</p>
            <h1 id="landing-title" className="font-display text-5xl font-semibold leading-[1.05] tracking-[-0.05em] sm:text-6xl xl:text-7xl">Less in your head.<br /><span className="text-muted-foreground">More in your day.</span></h1>
            <p className="mt-6 max-w-[420px] text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Bring your assignments, calendar, and plans together. A little clarity for school—and everything around it.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="lg" className="h-12 px-6"><Link href={primaryHref}>{primaryLabel}<ArrowRight className="h-4 w-4" /></Link></Button>
              {!isLoggedIn && <span className="text-sm text-muted-foreground">Make yourself at home.</span>}
            </div>
            <div className="mt-10 flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" />Canvas stays current</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Plan time your way</span>
            </div>
          </div>

          <figure className="mx-auto w-full max-w-[520px]" aria-label="Illustrative Orderly day plan with fictional tasks and events">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_16px_60px_-30px_rgba(0,0,0,0.25)]">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><CalendarDays className="h-4 w-4" />Your day, organized</div>
                <span className="rounded border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Example</span>
              </div>
              <div className="p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div><p className="text-xs text-muted-foreground">Wednesday</p><h2 className="mt-1 text-xl font-semibold tracking-tight">A little room to focus.</h2></div>
                  <div className="flex gap-3 text-muted-foreground" aria-hidden="true"><ChevronLeft className="h-4 w-4" /><ChevronRight className="h-4 w-4" /></div>
                </div>
                <div className="mt-5 space-y-0 divide-y divide-border rounded-xl border border-border px-4">
                  <div className="flex items-center gap-3 py-3.5"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary"><Check className="h-3 w-3" /></span><span className="flex-1 text-sm text-muted-foreground line-through">Read chapter 4</span><span className="text-[10px] text-muted-foreground">Done</span></div>
                  <div className="flex items-center gap-3 py-3.5"><Circle className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="flex-1 text-sm">English essay</span><span className="text-[10px] text-muted-foreground">Due tonight</span></div>
                </div>
                <div className="mt-6 grid grid-cols-[42px_1fr] gap-x-3 text-xs">
                  <span className="pt-3 text-muted-foreground">4 PM</span>
                  <div className="mb-3 rounded-lg border-l-2 border-primary bg-primary/10 px-4 py-3"><p className="font-medium">English essay</p><p className="mt-1 text-muted-foreground">4:00–5:00 PM · Focus time</p></div>
                  <span className="pt-3 text-muted-foreground">5 PM</span>
                  <div className="mb-3 rounded-lg border-l-2 border-emerald-600/50 bg-emerald-500/[0.07] px-4 py-3"><p className="font-medium">Basketball practice</p><p className="mt-1 text-muted-foreground">5:00–6:00 PM · Event</p></div>
                  <span className="pt-3 text-muted-foreground">6 PM</span>
                  <div className="flex h-11 items-center border-t border-dashed border-border px-4 text-muted-foreground">A little breathing room.</div>
                </div>
              </div>
            </div>
            <figcaption className="mt-4 text-center text-[11px] text-muted-foreground">One place for what’s due and when you’ll do it.</figcaption>
          </figure>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-6 sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground"><p>© {new Date().getFullYear()} Orderly</p><div className="flex gap-5"><Link href="/privacy" className="transition-colors hover:text-foreground">Privacy</Link><Link href="/terms" className="transition-colors hover:text-foreground">Terms</Link></div></div>
      </footer>
    </div>
  );
}
