'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Sparkles, ArrowLeft } from 'lucide-react';

export default function TermsOfServicePage() {
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
          <h1 className="mb-4 font-display text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Terms of Service</h1>
          <p className="mb-10 border-b border-border pb-8 text-sm text-muted-foreground">Last updated: August 27, 2026</p>

          <section className="space-y-9 [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-border/60 [&>div:not(:last-child)]:pb-9">
            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing or using Orderly (&quot;the Service&quot;), you agree to be bound by these Terms of Service. 
                If you do not agree to these terms, please do not use our Service. These terms apply to all 
                visitors, users, and others who access or use the Service.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">2. Description of Service</h2>
              <p className="text-muted-foreground leading-relaxed">
                Orderly is a web-based student planning and productivity platform with task management,
                calendars and schedules, study sessions, goals, exam planning, and optional connections
                to supported school services.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">3. User Accounts</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">When creating an account, you agree to:</p>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>Provide accurate and complete registration information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Notify us immediately of any unauthorized use of your account</li>
                <li>Accept responsibility for all activities under your account</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">4. Acceptable Use</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">You agree not to:</p>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>Use the Service for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to any part of the Service</li>
                <li>Interfere with or disrupt the Service or its infrastructure</li>
                <li>Upload malicious content or code</li>
                <li>Impersonate another person or entity</li>
                <li>Use the Service to harass, abuse, or harm others</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">5. Third-Party Integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service can connect to supported third-party school services and calendar feeds. By
                enabling a connection, you authorize Orderly to access and process the data needed to provide
                it, as described in our Privacy Policy. Your use of a connected service remains subject to that
                provider&apos;s terms. We are not responsible for changes, outages, or other issues with third-party
                services that may affect a connection.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">AI-Assisted Scheduling</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Assistant can interpret scheduling requests and suggest changes. AI output may be
                incomplete or inaccurate, so you are responsible for reviewing each preview, including its
                dates, times, durations, conflicts, and deadlines, before applying it. Orderly does not apply
                an Assistant suggestion without your approval.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">6. Intellectual Property</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service and its original content (excluding content provided by users) are and will 
                remain the exclusive property of Orderly. The Service is protected by copyright, 
                trademark, and other laws. Our trademarks may not be used in connection with any 
                product or service without prior written consent.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">7. User Content</h2>
              <p className="text-muted-foreground leading-relaxed">
                You retain ownership of any content you create within the Service (tasks, goals, notes, etc.). 
                By using the Service, you grant us a limited license to store, display, and process your 
                content solely for the purpose of providing the Service to you. We will not use your 
                content for any other purpose without your explicit consent.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">8. Service Availability</h2>
              <p className="text-muted-foreground leading-relaxed">
                We strive to maintain the Service&apos;s availability but do not guarantee uninterrupted 
                access. We may modify, suspend, or discontinue any part of the Service at any time 
                with reasonable notice. We are not liable for any downtime or service interruptions.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">9. Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                To the fullest extent permitted by law, Orderly shall not be liable for any indirect, 
                incidental, special, consequential, or punitive damages resulting from your use of or 
                inability to use the Service. The Service is provided &quot;as is&quot; without warranties 
                of any kind, either express or implied.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">10. Termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may terminate or suspend your account at any time if you violate these Terms. 
                You may also delete your account at any time. Upon termination, your right to use 
                the Service will cease immediately. Provisions of these Terms that by their nature 
                should survive termination will survive.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">11. Changes to Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify these Terms at any time. We will provide notice of 
                significant changes through the Service. Your continued use of the Service after 
                changes constitutes acceptance of the updated Terms.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">12. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have questions about these Terms of Service, please contact us 
                at <a href="mailto:support@orderly.app" className="text-primary hover:underline underline-offset-4">support@orderly.app</a>.
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
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="text-foreground font-medium">Terms</Link>
          </div>
          <p className="text-sm text-muted-foreground">© 2025 Orderly. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
