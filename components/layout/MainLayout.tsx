'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarOpen } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar using Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-[260px]">
          <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <motion.div
        initial={false}
        animate={{ marginLeft: isDesktop ? (sidebarOpen ? 240 : 72) : 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="flex flex-col min-h-screen"
      >
        <Header onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-10">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </motion.div>
    </div>
  );
}
