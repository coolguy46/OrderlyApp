import { CheckCircle2, ShieldCheck } from 'lucide-react';

const steps = [
  {
    title: 'Log into Canvas',
    description: 'Use your school’s Canvas website and sign in to your own account.',
  },
  {
    title: 'Open Calendar',
    description: 'Choose Calendar from the Canvas navigation.',
  },
  {
    title: 'Choose Calendar Feed',
    description: 'On the right side of the Canvas calendar, select Calendar Feed.',
  },
  {
    title: 'Copy the feed link',
    description: 'Copy the entire link shown in Calendar Feed, not the address in your browser’s address bar.',
  },
  {
    title: 'Open Orderly’s Integrations',
    description: 'Go to Settings → Integrations in Orderly.',
  },
  {
    title: 'Paste and connect',
    description: 'Paste the link into Calendar feed URL, then select Connect Canvas. Let the first import finish.',
  },
] as const;

/** Shared instructions only: opening the guide never connects or changes an account. */
export default function CanvasGuide() {
  return (
    <div className="space-y-5 text-sm leading-6 [overflow-wrap:anywhere]" data-canvas-guide>
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.title} className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4">
            <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-foreground">{step.title}</p>
              <p className="mt-0.5 text-muted-foreground">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Check your first import
        </div>
        <p className="mt-1.5 text-muted-foreground">
          Connected means your link is saved. A recent Last synced time confirms an import finished.
          Find imported assignments in Tasks and their deadlines in Task Calendar; recognized exams
          appear in Exams. Only items available in the calendar feed can be imported.
        </p>
        <p className="mt-2 text-muted-foreground">
          Use Sync now for a manual update. Automatic updates can run in the background at your
          selected interval. If you see Sync paused, select Turn on under Automatic updates to resume them.
        </p>
      </div>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="cursor-pointer rounded-xl px-4 py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Having trouble connecting?
        </summary>
        <ul className="list-disc space-y-2 px-4 pb-4 pl-8 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Link rejected or no assignments?</span>{' '}
            Copy the full Calendar Feed link again. A Canvas page address is not a feed link.
            If the wrong link is already saved, use Disconnect, then paste the fresh link and connect again.
          </li>
          <li>
            <span className="font-medium text-foreground">Sync failed or timed out?</span>{' '}
            Read the error shown above the connection controls, check your internet connection,
            and try Sync now again. If a sync is already running or you are asked to wait,
            give it time before retrying.
          </li>
          <li>
            <span className="font-medium text-foreground">Still not working?</span>{' '}
            Keep the error message for troubleshooting, but hide the private feed link in any screenshot.
            An unavailable service or database error cannot be fixed by repeatedly reconnecting.
          </li>
        </ul>
      </details>

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Keep your feed link private. It gives access to your calendar information. This is a read-only
          connection: checking off work in Orderly does not submit it or change Canvas.
        </span>
      </p>
    </div>
  );
}
