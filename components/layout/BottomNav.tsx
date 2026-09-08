'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  CheckSquare,
  Timer,
  MoreHorizontal,
  GraduationCap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Home' },
  { href: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { href: '/study', icon: Timer, label: 'Study' },
  { href: '/exams', icon: GraduationCap, label: 'Exams' },
];

interface BottomNavProps {
  onMoreTap: () => void;
}

export function BottomNav({ onMoreTap }: BottomNavProps) {
  const pathname = usePathname();

  // Check if current page is one of the "more" pages
  const morePaths = ['/goals', '/calendar', '/planner', '/settings', '/profile'];
  const isMoreActive = morePaths.some((p) => pathname.startsWith(p));

  return (
    <nav aria-label="Mobile navigation" className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border/80 bg-card/95 backdrop-blur-md safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-w-[56px] rounded-xl transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="bottomNavActive"
                  className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                />
              )}
              <item.icon className={cn('w-5 h-5', isActive && 'text-primary')} />
              <span className={cn(
                'text-[10px] font-medium leading-none',
                isActive && 'text-primary'
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* More button */}
        <button
          onClick={onMoreTap}
          className={cn(
            'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-w-[56px] rounded-xl transition-colors',
            isMoreActive ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {isMoreActive && (
            <motion.div
              layoutId="bottomNavActive"
              className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full"
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            />
          )}
          <MoreHorizontal className={cn('w-5 h-5', isMoreActive && 'text-primary')} />
          <span className={cn(
            'text-[10px] font-medium leading-none',
            isMoreActive && 'text-primary'
          )}>
            More
          </span>
        </button>
      </div>
    </nav>
  );
}
