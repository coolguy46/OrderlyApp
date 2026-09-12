'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Sparkles, ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link href="/landing" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Orderly</span>
          </Link>
          <Link href="/landing">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </nav>

      <main className="px-5 py-12 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-[760px] [overflow-wrap:anywhere]">
          <h1 className="mb-4 font-display text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Privacy Policy</h1>
          <p className="mb-10 border-b border-border pb-8 text-sm text-muted-foreground">Last updated: September 11, 2026</p>

          <section className="space-y-9 [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-border/60 [&>div:not(:last-child)]:pb-9">
            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                Welcome to Orderly (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting your personal 
                information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, 
                and safeguard your information when you use our web application and services.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">2. Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">
                We collect information that you provide directly to us when you:
              </p>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>Create an account (email address, name, profile information)</li>
                <li>Use our planning features (tasks, schedules, goals, study sessions, and exams)</li>
                <li>Connect supported school services or calendar feeds</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">3. School Service Integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you connect a supported school service or calendar feed, we process the course names,
                assignments, due dates, and calendar events needed to import and sync your academic data.
                Depending on how you connect, we may store a feed URL or authorization tokens. We use this
                access only to provide the integration you request.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">4. How We Use Your Information</h2>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>To provide, maintain, and improve our services</li>
                <li>To manage your account and provide customer support</li>
                <li>To organize your tasks, schedules, goals, study sessions, and exams</li>
                <li>To import and sync academic data from connected services</li>
                <li>To show progress based on the activity you record</li>
                <li>To send important updates about our services (with your consent)</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">AI Assistant</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you use the Assistant, Orderly sends your messages, recent conversation context, and
                account planning information to DeepSeek to interpret and answer your request. Depending
                on the request, this includes task titles, assignment descriptions, deadlines and completion
                status, scheduled work, events, exams, routines, busy times, and planning preferences.
                Do not include passwords, private calendar-feed links, or other secrets in your messages.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-3">
                When you ask the Assistant to make changes, it can save tasks, events, and schedule changes
                directly after application checks; a separate preview approval is not always required.
                Orderly stores saved action results to support conversation continuity and safe retries,
                and records request and token usage for service operation and abuse protection.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Subscription Payments</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you start an AI trial or subscription, Stripe collects your payment information in its
                hosted checkout and customer portal. Orderly does not store your full card number or security
                code. We send Stripe an internal account identifier and store the customer and checkout
                identifiers needed to associate billing with your account and safely retry requests.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-3">
                We retrieve subscription and invoice status from Stripe to verify AI access, trial eligibility,
                and cancellation. We record payment-event identifiers, event types, and timestamps to process
                notifications reliably; we do not store full payment-event payloads. Stripe also processes
                billing information under its <a href="https://stripe.com/privacy" className="text-primary underline underline-offset-4">privacy policy</a>.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">5. Data Storage and Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your data is stored securely using Supabase infrastructure with PostgreSQL databases. 
                We implement row-level security (RLS) policies to ensure that users can only access 
                their own data. All data transmission is encrypted using TLS/SSL protocols. 
                Third-party integration credentials are stored securely and used only
                for the purposes described in this policy.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">6. Data Sharing</h2>
              <p className="text-muted-foreground leading-relaxed">
                We do not sell, trade, or rent your personal information to third parties. 
                We may share your information only in the following circumstances:
              </p>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground mt-3">
                <li>With your explicit consent</li>
                <li>To comply with legal obligations</li>
                <li>To protect our rights and prevent fraud</li>
                <li>With service providers that host, secure, or support our platform</li>
                <li>With our AI provider when you choose to use the Assistant</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">7. Data Retention and Deletion</h2>
              <p className="text-muted-foreground leading-relaxed">
                We retain your personal data for as long as your account is active. You may request 
                deletion of your account and all associated data at any time by contacting us. 
                When you disconnect a third-party integration, we stop future access and remove connection
                credentials we no longer need. Data already imported into your account may remain until you
                delete it or delete your account.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">8. Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed">You have the right to:</p>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground mt-3">
                <li>Access, update, or delete your personal information</li>
                <li>Disconnect third-party integrations at any time</li>
                <li>Request a copy of your data</li>
                <li>Opt out of non-essential communications</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">9. Children&apos;s Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                Orderly is designed for students aged 13 and older. We do not knowingly collect 
                personal information from children under 13. If you believe we have collected 
                information from a child under 13, please contact us immediately.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">10. Changes to This Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of any 
                changes by updating the &quot;Last updated&quot; date and, for significant changes, 
                by providing additional notice through the application.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">11. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have questions about this Privacy Policy or our data practices, 
                please contact us at <a href="mailto:support@orderly.app" className="text-primary hover:underline underline-offset-4">support@orderly.app</a>.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/40 px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">Orderly</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/landing" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/privacy" className="text-foreground font-medium">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
          <p className="text-sm text-muted-foreground">© 2025 Orderly. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
