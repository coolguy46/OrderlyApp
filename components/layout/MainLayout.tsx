'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { usePathname } from 'next/navigation';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { useMediaQuery } from '@/lib/use-hydrated';
import { TutorialProvider, TutorialInvitation } from '@/components/tutorial/Tutorial';
import { AppReminders } from './AppReminders';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarOpen, user } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const pathname = usePathname();

  const [mobileMenuPathname, setMobileMenuPathname] = useState(pathname);
  if (mobileMenuPathname !== pathname) {
    setMobileMenuPathname(pathname);
    setMobileMenuOpen(false);
  }

  return (
    <TutorialProvider userId={user?.id}>
    <MotionConfig reducedMotion="user">
    <AppReminders />
    <div className="workspace-shell min-h-dvh bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground">Skip to content</a>
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
        className="flex min-w-0 flex-col min-h-dvh"
      >
        <Header />
        <main id="main-content" tabIndex={-1} className="relative mx-auto w-full min-w-0 max-w-[1680px] flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-8 lg:pb-10 lg:pt-8 xl:px-10">
          {pathname === '/' && <TutorialInvitation />}
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
    </MotionConfig>
    </TutorialProvider>
  );
}
