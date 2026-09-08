'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { Button, Avatar, AvatarFallback, ScrollArea } from '@/components/ui';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  CheckSquare,
  Calendar,
  Target,
  Timer,
  GraduationCap,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { href: '/calendar', icon: Calendar, label: 'Calendar' },
  { href: '/planner', icon: CalendarClock, label: 'Assistant' },
  { href: '/goals', icon: Target, label: 'Goals' },
  { href: '/study', icon: Timer, label: 'Study' },
  { href: '/exams', icon: GraduationCap, label: 'Exams' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ mobile, onNavigate }: SidebarProps = {}) {
  const { sidebarOpen, setSidebarOpen, user } = useAppStore();
  const pathname = usePathname();

  // In mobile mode, always show expanded and don't use fixed positioning
  const effectiveOpen = mobile ? true : sidebarOpen;

  return (
    <motion.aside
      initial={false}
      animate={{ width: mobile ? '100%' : (sidebarOpen ? 240 : 72) }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={cn(
        "workspace-sidebar h-full bg-sidebar border-r border-border/70 flex flex-col",
        mobile ? "w-full" : "fixed left-0 top-0 z-40"
      )}
    >
      {/* Logo */}
      <div className="h-[76px] flex shrink-0 items-center px-4">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Go to dashboard"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Image src="/logo.svg" alt="Orderly Logo" width={36} height={36} className="h-9 w-9 shrink-0 rounded-xl" priority />
          {effectiveOpen && <span className="min-w-0 whitespace-nowrap"><span className="block font-display text-base font-semibold tracking-tight">Orderly</span><span className="block text-[10px] text-muted-foreground">Your student workspace</span></span>}
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="min-h-0 flex-1 py-3">
        <nav aria-label="Main navigation" className="space-y-5 px-3">
          {[
            { label: 'Workspace', items: navItems.slice(0, 4) },
            { label: 'Your progress', items: navItems.slice(4, 7) },
            { label: 'Preferences', items: navItems.slice(7) },
          ].map(group => <div key={group.label} className="space-y-1">
            {effectiveOpen && <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{group.label}</p>}
          {group.items.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} onClick={onNavigate} aria-label={item.label} aria-current={isActive ? 'page' : undefined} title={!effectiveOpen ? item.label : undefined}
                  className={cn(
                    'workspace-nav-item relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                    !effectiveOpen && 'justify-center px-0'
                  )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                {effectiveOpen && <span className="whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}</div>)}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 space-y-2 border-t border-border/70 p-3">
        {/* Collapse button - hidden on mobile */}
        {!mobile && (
          <Button
            variant="ghost"
            size={effectiveOpen ? "sm" : "icon-sm"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={effectiveOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className={cn("w-full text-xs text-muted-foreground", effectiveOpen ? "justify-start px-3" : "justify-center")}
          >
            {effectiveOpen ? (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span>Collapse</span>
              </>
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        )}

        {/* User Profile */}
        <Link href="/profile" onClick={onNavigate} aria-label="Your profile"
            className={cn(
              'flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !effectiveOpen && 'justify-center'
            )}
        >
            <Avatar className="h-8 w-8 rounded-lg border border-border">
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                {user?.full_name?.[0] || 'U'}
              </AvatarFallback>
            </Avatar>
              {effectiveOpen && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {user?.full_name || 'Demo User'}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {user?.tasks_completed || 0} {user?.tasks_completed === 1 ? 'task' : 'tasks'} completed
                    </span>
                  </div>
                </div>
              )}
        </Link>
      </div>
    </motion.aside>
  );
}
