import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Check } from 'lucide-react';

/** Presentation only. Authentication and recovery remain owned by each page. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="workspace-shell min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 sm:px-10">
        <Link href="/landing" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Image src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9 rounded-lg" priority />
          <span className="text-lg font-semibold tracking-tight">Orderly<span className="text-primary">.</span></span>
        </Link>
        <Link href="/landing" className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft className="h-4 w-4" />Back to home</Link>
      </header>
      <main className="mx-auto grid min-h-[calc(100svh-6rem)] w-full max-w-6xl items-center gap-12 px-5 pb-10 pt-4 sm:px-10 lg:grid-cols-[1fr_1.05fr] lg:gap-24 lg:py-12">
        <aside className="hidden self-center lg:block" aria-label="About Orderly">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Room for what matters</p>
          <h1 className="font-display text-5xl font-semibold leading-[1.08] tracking-[-0.045em]">A little structure.<br /><span className="text-muted-foreground">A clearer day.</span></h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-muted-foreground">Schoolwork, plans, and everything in between. Keep it all in one thoughtful workspace.</p>
          <div className="mt-10 max-w-sm overflow-hidden rounded-2xl border border-border bg-card" aria-hidden="true">
            <div className="flex items-center justify-between border-b border-border px-5 py-4"><span className="text-sm font-medium">A little more organized</span><CalendarDays className="h-4 w-4 text-muted-foreground" /></div>
            <div className="flex items-center gap-3 px-5 py-4 text-sm"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-3 w-3" /></span><span className="text-muted-foreground">Know what needs your attention</span></div>
            <div className="mx-5 mb-5 rounded-lg border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm"><span className="font-medium">Make time for it</span><p className="mt-1 text-xs text-muted-foreground">Your plans, at your pace.</p></div>
          </div>
        </aside>
        <div className="mx-auto w-full max-w-[460px]">{children}</div>
      </main>
    </div>
  );
}
