'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Sparkles, ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/landing" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold">Orderly</span>
          </Link>
          <Link href="/landing">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </nav>

      <main className="pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto prose prose-invert">
          <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-lg mb-10">Last updated: August 27, 2026</p>

          <section className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-3">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                Welcome to Orderly (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting your personal 
                information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, 
                and safeguard your information when you use our web application and services.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">2. Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">
                We collect information that you provide directly to us when you:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Create an account (email address, name, profile information)</li>
                <li>Use our planning features (tasks, schedules, goals, study sessions, and exams)</li>
                <li>Connect supported school services or calendar feeds</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">3. School Service Integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you connect a supported school service or calendar feed, we process the course names,
                assignments, due dates, and calendar events needed to import and sync your academic data.
                Depending on how you connect, we may store a feed URL or authorization tokens. We use this
                access only to provide the integration you request.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">4. How We Use Your Information</h2>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>To provide, maintain, and improve our services</li>
                <li>To manage your account and provide customer support</li>
                <li>To organize your tasks, schedules, goals, study sessions, and exams</li>
                <li>To import and sync academic data from connected services</li>
                <li>To show progress based on the activity you record</li>
                <li>To send important updates about our services (with your consent)</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">AI Assistant</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you submit a request to the Assistant, Orderly sends your request and a limited set of
                relevant task and schedule details to DeepSeek so the request can be interpreted. This may
                include task titles, assignment descriptions, deadlines, scheduled work, and busy times.
                This information is sent only when you use the Assistant. The Assistant produces a preview;
                it does not change your schedule until you approve the preview.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">5. Data Storage and Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your data is stored securely using Supabase infrastructure with PostgreSQL databases. 
                We implement row-level security (RLS) policies to ensure that users can only access 
                their own data. All data transmission is encrypted using TLS/SSL protocols. 
                Third-party integration credentials are stored securely and used only
                for the purposes described in this policy.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">6. Data Sharing</h2>
              <p className="text-muted-foreground leading-relaxed">
                We do not sell, trade, or rent your personal information to third parties. 
                We may share your information only in the following circumstances:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
                <li>With your explicit consent</li>
                <li>To comply with legal obligations</li>
                <li>To protect our rights and prevent fraud</li>
                <li>With service providers that host, secure, or support our platform</li>
                <li>With our AI provider when you choose to use the Assistant</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">7. Data Retention and Deletion</h2>
              <p className="text-muted-foreground leading-relaxed">
                We retain your personal data for as long as your account is active. You may request 
                deletion of your account and all associated data at any time by contacting us. 
                When you disconnect a third-party integration, we stop future access and remove connection
                credentials we no longer need. Data already imported into your account may remain until you
                delete it or delete your account.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">8. Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed">You have the right to:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground mt-3">
                <li>Access, update, or delete your personal information</li>
                <li>Disconnect third-party integrations at any time</li>
                <li>Request a copy of your data</li>
                <li>Opt out of non-essential communications</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">9. Children&apos;s Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                Orderly is designed for students aged 13 and older. We do not knowingly collect 
                personal information from children under 13. If you believe we have collected 
                information from a child under 13, please contact us immediately.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">10. Changes to This Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of any 
                changes by updating the &quot;Last updated&quot; date and, for significant changes, 
                by providing additional notice through the application.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">11. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have questions about this Privacy Policy or our data practices, 
                please contact us at <a href="mailto:support@orderly.app" className="text-indigo-400 hover:text-indigo-300">support@orderly.app</a>.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border/40">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
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
