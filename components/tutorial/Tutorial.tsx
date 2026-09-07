'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleHelp, ExternalLink, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { emptyTutorialProgress, parseTutorialProgress, tutorialStorageKey, type TutorialProgress } from '@/lib/tutorial-progress';
import { TUTORIAL_SECTIONS } from './sections';
import CanvasGuide from './CanvasGuide';

const sectionIds = TUTORIAL_SECTIONS.map(section => section.id);
const TutorialContext = createContext<{
  showHelp: () => void;
  dismissInvitation: () => void;
  showInvitation: boolean;
  registerHelpButton: (node: HTMLButtonElement | null) => void;
} | null>(null);

/** Only tutorial preferences are stored. No task, planner, auth or integration writes. */
export function TutorialProvider({ userId, children }: { userId?: string | null; children: ReactNode }) {
  return <TutorialSession key={userId || 'signed-out'} userId={userId}>{children}</TutorialSession>;
}

function TutorialSession({ userId, children }: { userId?: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<number | null>(null);
  const [progress, setProgress] = useState<TutorialProgress>(emptyTutorialProgress);
  const [loaded, setLoaded] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const storageKey = tutorialStorageKey(userId);
  const registerHelpButton = useCallback((node: HTMLButtonElement | null) => { helpButtonRef.current = node; }, []);

  useEffect(() => {
    // Read browser preferences after hydration, never from server rendering.
    let saved = emptyTutorialProgress();
    let unavailable = false;
    try {
      if (storageKey) saved = parseTutorialProgress(localStorage.getItem(storageKey), sectionIds);
    } catch { unavailable = true; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate account-scoped browser preferences
    setProgress(saved);
    setStorageUnavailable(unavailable);
    setLoaded(true);
  }, [storageKey]);

  const persist = (next: TutorialProgress) => {
    setProgress(next);
    try {
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    } catch { setStorageUnavailable(true); }
  };
  const close = () => {
    persist({ ...progress, dismissed: true });
    setOpen(false);
  };
  const showHelp = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSection(null);
    setOpen(true);
    persist({ ...progress, dismissed: true });
  };
  const selectSection = (index: number) => {
    const bounded = Math.max(0, Math.min(index, TUTORIAL_SECTIONS.length - 1));
    const id = sectionIds[bounded];
    setSection(bounded);
    persist({ ...progress, current: id, visited: [...new Set([...progress.visited, id])], dismissed: true });
  };
  const restart = () => {
    setSection(0);
    persist({ current: sectionIds[0], visited: [sectionIds[0]], dismissed: true, completed: false });
  };

  useEffect(() => {
    if (!open) return;
    contentRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [section, open]);

  const current = section === null ? null : TUTORIAL_SECTIONS[section];
  const last = section === TUTORIAL_SECTIONS.length - 1;

  return <TutorialContext.Provider value={{
    showHelp, registerHelpButton,
    showInvitation: Boolean(userId && loaded && !progress.dismissed && !progress.completed && !open),
    dismissInvitation: () => persist({ ...progress, dismissed: true }),
  }}>
    {children}
    <Dialog.Root open={open} onOpenChange={next => { if (!next) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="tutorial-description"
          onOpenAutoFocus={event => { event.preventDefault(); headingRef.current?.focus(); }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = returnFocusRef.current;
            (target?.isConnected ? target : helpButtonRef.current)?.focus();
          }}
          className="fixed inset-x-2 top-1/2 z-[71] flex h-[min(820px,calc(100dvh-1rem))] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl outline-none sm:inset-x-auto sm:left-1/2 sm:w-[calc(100%-3rem)] sm:max-w-[1080px] sm:-translate-x-1/2 sm:rounded-3xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BookOpen className="h-5 w-5" aria-hidden="true" /></div>
              <div className="min-w-0">
                <Dialog.Title className="text-sm font-semibold sm:text-base">Your guide to Orderly</Dialog.Title>
                <Dialog.Description id="tutorial-description" className="text-xs text-muted-foreground">Learn at your pace. Your real data stays untouched.</Dialog.Description>
              </div>
            </div>
            <button type="button" onClick={close} aria-label="Close tutorial" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="h-5 w-5" /></button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            {current && <>
              <nav aria-label="Tutorial sections" data-testid="tutorial-section-menu" className="hidden w-52 shrink-0 overflow-y-auto border-r border-border/60 p-3 sm:block">
                <button type="button" onClick={() => setSection(null)} className="mb-3 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft className="h-4 w-4" />All sections</button>
                {TUTORIAL_SECTIONS.map((item, index) => <button key={item.id} type="button" data-section-id={item.id} onClick={() => selectSection(index)} aria-current={section === index ? 'step' : undefined} className={cn('mb-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', section === index ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[10px] tabular-nums">{progress.visited.includes(item.id) && section !== index ? <Check className="h-3.5 w-3.5" aria-label="Visited" /> : String(index + 1).padStart(2, '0')}</span>{item.label}
                </button>)}
              </nav>
              <div className="shrink-0 border-b border-border/60 px-4 py-2 sm:hidden">
                <label htmlFor="tutorial-section-select" className="sr-only">Tutorial section</label>
                <select id="tutorial-section-select" value={section ?? ''} onChange={event => event.target.value === '' ? setSection(null) : selectSection(Number(event.target.value))} className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <option value="">All sections</option>
                  {TUTORIAL_SECTIONS.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.label}</option>)}
                </select>
              </div>
            </>}

            <div ref={contentRef} data-testid="tutorial-content" data-tutorial-section={current?.id || 'overview'} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:p-7">
              {current ? <article>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{current.label} · {section! + 1} of {TUTORIAL_SECTIONS.length}</p>
                <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl">{current.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{current.description}</p>
                <div className="mt-5">
                  {current.id === 'canvas' ? <CanvasGuide /> : <ol className="space-y-4">
                    {current.steps.map((text, index) => <li key={text} className="flex gap-3 text-sm leading-6"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{index + 1}</span><span>{text}</span></li>)}
                  </ol>}
                </div>
                <figure className="my-5 overflow-hidden rounded-xl border border-border bg-muted/20">
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-[10px] text-muted-foreground"><span>DEMO · ALEX MORGAN</span><span>SEP 7, 2026</span></div>
                  {/* Pre-captured local WebP: no private account or remote image request. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img key={current.image} src={`/tutorial/${current.image}.webp`} alt={current.imageAlt} width={current.image.endsWith('-editor') ? 620 : 1160} height={current.image === 'settings' ? 495 : 850} loading="lazy" decoding="async" className="mx-auto h-auto w-full max-w-[1160px] bg-[#080c16]" />
                  <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground"><span>Real interface. Fictional data.</span><a href={`/tutorial/${current.image}.webp`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Full-size screenshot<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></figcaption>
                </figure>
                <div className="mt-5 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm leading-6">{current.takeaway}</div>
                <Link href={current.href} onClick={close} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Open {current.destination}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </article> : <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">A little guidance. A clearer day.</p>
                <h2 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl">Make yourself at home.</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Take the full tour, or jump to what you need. Explore with Alex’s fictional tasks and events—nothing in this guide changes your account.</p>
                <div className="my-5 flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => selectSection(progress.current && !progress.completed ? Math.max(0, sectionIds.indexOf(progress.current)) : 0)} className="min-h-11 gap-2">{progress.current && !progress.completed ? 'Continue tour' : 'Start tour'}<ArrowRight className="h-4 w-4" /></Button>
                  {progress.current && <Button type="button" variant="ghost" onClick={restart} className="min-h-11 gap-2"><RotateCcw className="h-4 w-4" />Restart tour</Button>}
                  <span className="text-xs text-muted-foreground">{TUTORIAL_SECTIONS.length} short sections · always replayable</span>
                </div>
                {progress.completed && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" />Tour finished. Come back whenever you need a hand.</p>}
                <nav aria-label="Tutorial sections" data-testid="tutorial-section-menu" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
                  {TUTORIAL_SECTIONS.map((item, index) => <button key={item.id} type="button" data-section-id={item.id} onClick={() => selectSection(index)} className="group flex min-h-[78px] items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3 text-left hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs leading-4 text-muted-foreground">{item.title}</span></span>
                    {progress.visited.includes(item.id) && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Visited" />}
                  </button>)}
                </nav>
                <p className="mt-5 text-xs leading-5 text-muted-foreground">Progress is saved for this account in this browser. {storageUnavailable ? 'Browser storage is unavailable; you can still use every section, but progress may reset when you leave.' : 'You can close the guide at any time and return using the question mark beside your profile.'}</p>
              </div>}
            </div>
          </div>

          <footer className="shrink-0 border-t border-border/60 bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
            {current && <div role="progressbar" aria-label="Tutorial progress" aria-valuenow={section! + 1} aria-valuemin={0} aria-valuemax={TUTORIAL_SECTIONS.length} className="mb-3 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${((section! + 1) / TUTORIAL_SECTIONS.length) * 100}%` }} /></div>}
            <div className="flex items-center justify-between gap-1">
              <Button type="button" variant="ghost" onClick={close} className="min-h-11 px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm">Skip tutorial</Button>
              {current ? <div className="flex items-center gap-1 sm:gap-2">
                <Button type="button" variant="outline" onClick={() => section === 0 ? setSection(null) : selectSection(section! - 1)} className="min-h-11 gap-1 px-2 sm:px-4"><ArrowLeft className="h-4 w-4" /><span>Back</span></Button>
                <Button type="button" onClick={() => {
                  if (last) { persist({ ...progress, dismissed: true, completed: true }); setSection(null); }
                  else selectSection(section! + 1);
                }} className="min-h-11 gap-1 px-2 text-xs sm:px-4 sm:text-sm">{last ? 'Finish tutorial' : 'Next'}{last ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</Button>
              </div> : <p className="px-2 text-xs text-muted-foreground">Your space. Your pace.</p>}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </TutorialContext.Provider>;
}

export function TutorialHelpButton() {
  const tutorial = useContext(TutorialContext);
  if (!tutorial) return null;
  return <button ref={node => tutorial.registerHelpButton(node)} type="button" onClick={() => tutorial.showHelp()} aria-label="Help and tutorial" title="Help and tutorial" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><CircleHelp className="h-5 w-5" aria-hidden="true" /></button>;
}

export function TutorialInvitation() {
  const tutorial = useContext(TutorialContext);
  if (!tutorial?.showInvitation) return null;
  return <aside aria-label="Welcome guide" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:px-4">
    <BookOpen className="hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="text-sm font-medium">A quick look around?</p><p className="text-xs leading-5 text-muted-foreground">Learn Orderly with a demo, or get straight to your day.</p></div>
    <Button type="button" variant="outline" size="sm" onClick={tutorial.showHelp} className="min-h-10">Take a tour</Button>
    <button type="button" onClick={tutorial.dismissInvitation} aria-label="Dismiss tutorial invitation" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="h-4 w-4" /></button>
  </aside>;
}
