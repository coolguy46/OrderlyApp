'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { motion, AnimatePresence } from 'framer-motion';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { usePathname } from 'next/navigation';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { useMediaQuery } from '@/lib/use-hydrated';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarOpen } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const pathname = usePathname();

  const [mobileMenuPathname, setMobileMenuPathname] = useState(pathname);
  if (mobileMenuPathname !== pathname) {
    setMobileMenuPathname(pathname);
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-dvh bg-background bg-grain mesh-gradient">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar using Sheet — triggered by "More" in bottom nav */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-[280px]">
          <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <motion.div
        initial={false}
        animate={{ marginLeft: isDesktop ? (sidebarOpen ? 240 : 72) : 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="flex flex-col min-h-dvh"
      >
        <Header />
        <main className="flex-1 px-4 pt-4 pb-20 sm:px-6 sm:pb-6 lg:px-10 lg:pb-10 lg:pt-6 relative">
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </main>
      </motion.div>

      {/* Mobile bottom navigation */}
      <BottomNav onMoreTap={() => setMobileMenuOpen(true)} />
    </div>
  );
}
