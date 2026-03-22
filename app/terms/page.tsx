'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Sparkles, ArrowLeft } from 'lucide-react';

export default function TermsOfServicePage() {
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
          <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground text-lg mb-10">Last updated: January 2025</p>

          <section className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing or using Orderly (&quot;the Service&quot;), you agree to be bound by these Terms of Service. 
                If you do not agree to these terms, please do not use our Service. These terms apply to all 
                visitors, users, and others who access or use the Service.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">2. Description of Service</h2>
              <p className="text-muted-foreground leading-relaxed">
                Orderly is a web-based student productivity platform that provides task management, 
                study timer, goal tracking, exam preparation tools, analytics, and social learning features. 
                The Service also offers integrations with third-party platforms including Google Classroom 
                and Canvas LMS to help students sync academic data.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">3. User Accounts</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">When creating an account, you agree to:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Provide accurate and complete registration information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Notify us immediately of any unauthorized use of your account</li>
                <li>Accept responsibility for all activities under your account</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">4. Acceptable Use</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">You agree not to:</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Use the Service for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to any part of the Service</li>
                <li>Interfere with or disrupt the Service or its infrastructure</li>
                <li>Upload malicious content or code</li>
                <li>Impersonate another person or entity</li>
                <li>Use the Service to harass, abuse, or harm others</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">5. Third-Party Integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service integrates with third-party platforms such as Google Classroom and Canvas LMS. 
                By connecting these integrations, you authorize Orderly to access your data from these 
                services as described in our Privacy Policy. You are also subject to the terms of service 
                of these third-party platforms. We are not responsible for any changes, outages, or issues 
                with third-party services that may affect our integrations.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">6. Intellectual Property</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service and its original content (excluding content provided by users) are and will 
                remain the exclusive property of Orderly. The Service is protected by copyright, 
                trademark, and other laws. Our trademarks may not be used in connection with any 
                product or service without prior written consent.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">7. User Content</h2>
              <p className="text-muted-foreground leading-relaxed">
                You retain ownership of any content you create within the Service (tasks, goals, notes, etc.). 
                By using the Service, you grant us a limited license to store, display, and process your 
                content solely for the purpose of providing the Service to you. We will not use your 
                content for any other purpose without your explicit consent.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">8. Service Availability</h2>
              <p className="text-muted-foreground leading-relaxed">
                We strive to maintain the Service&apos;s availability but do not guarantee uninterrupted 
                access. We may modify, suspend, or discontinue any part of the Service at any time 
                with reasonable notice. We are not liable for any downtime or service interruptions.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">9. Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                To the fullest extent permitted by law, Orderly shall not be liable for any indirect, 
                incidental, special, consequential, or punitive damages resulting from your use of or 
                inability to use the Service. The Service is provided &quot;as is&quot; without warranties 
                of any kind, either express or implied.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">10. Termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may terminate or suspend your account at any time if you violate these Terms. 
                You may also delete your account at any time. Upon termination, your right to use 
                the Service will cease immediately. Provisions of these Terms that by their nature 
                should survive termination will survive.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">11. Changes to Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify these Terms at any time. We will provide notice of 
                significant changes through the Service. Your continued use of the Service after 
                changes constitutes acceptance of the updated Terms.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-3">12. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have questions about these Terms of Service, please contact us 
                at <a href="mailto:support@orderly.app" className="text-indigo-400 hover:text-indigo-300">support@orderly.app</a>.
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
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="text-foreground font-medium">Terms</Link>
          </div>
          <p className="text-sm text-muted-foreground">© 2025 Orderly. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
