'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { Button, Avatar, AvatarFallback, Separator, ScrollArea } from '@/components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  CheckSquare,
  Calendar,
  Target,
  Timer,
  BarChart3,
  GraduationCap,
  Users,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  LogOut,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { href: '/calendar', icon: Calendar, label: 'Calendar' },
  { href: '/goals', icon: Target, label: 'Goals' },
  { href: '/study', icon: Timer, label: 'Study Session' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/exams', icon: GraduationCap, label: 'Exams' },
  { href: '/social', icon: Users, label: 'Social' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen, user } = useAppStore();
  const pathname = usePathname();

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarOpen ? 240 : 72 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="fixed left-0 top-0 h-full bg-card/50 backdrop-blur-md border-r border-border/40 z-40 flex flex-col"
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex-shrink-0 shadow-lg">
            <img src="/logo.svg" alt="Orderly Logo" className="w-10 h-10" />
          </div>
          <AnimatePresence>
            {sidebarOpen && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="font-semibold text-base whitespace-nowrap"
              >
                Orderly
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-6">
        <nav className="px-3 space-y-1.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <motion.div
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all',
                    isActive
                      ? 'bg-primary/10 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  <item.icon className={cn(
                    'w-5 h-5 flex-shrink-0',
                    isActive && 'text-primary'
                  )} />
                  <AnimatePresence>
                    {sidebarOpen && (
                      <motion.span
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="text-xs font-medium whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t space-y-2">
        {/* Collapse button */}
        <Button
          variant="ghost"
          size={sidebarOpen ? "sm" : "icon-sm"}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={cn("w-full", !sidebarOpen && "justify-center")}
        >
          {sidebarOpen ? (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </Button>

        <Separator />

        {/* User Profile */}
        <Link href="/profile">
          <div className={cn(
            'flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors',
            !sidebarOpen && 'justify-center'
          )}>
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs">
                {user?.full_name?.[0] || 'U'}
              </AvatarFallback>
            </Avatar>
            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex-1 min-w-0"
                >
                  <p className="text-xs font-medium truncate">
                    {user?.full_name || 'Demo User'}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {user?.current_streak || 0} day streak
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Link>
      </div>
    </motion.aside>
  );
}
