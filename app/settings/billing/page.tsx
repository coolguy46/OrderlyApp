import Link from 'next/link';
import { MainLayout } from '@/components/layout';
import { BillingPanel } from '@/components/billing/BillingPanel';

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  return <MainLayout><div className="workspace-page mx-auto max-w-2xl space-y-6">
    <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">← Settings</Link>
    <div><p className="workspace-eyebrow">Your account</p><h1 className="workspace-title">Billing</h1></div>
    <BillingPanel returnState={checkout === 'success' || checkout === 'canceled' ? checkout : ''} />
  </div></MainLayout>;
}
