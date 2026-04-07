'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useHotkeys } from '@/lib/useHotkeys';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Button, 
  Input,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { 
  Search, 
  Settings, 
  User, 
  LogOut,
  Menu,
  CheckSquare,
  Target,
  GraduationCap,
  X,
  ArrowLeft,
  HelpCircle,
  Crown,
} from 'lucide-react';
import Link from 'next/link';
import { Tutorial } from '@/components/tutorial/Tutorial';

interface HeaderProps {
  onMobileMenuToggle?: () => void;
}

export function Header({ onMobileMenuToggle }: HeaderProps) {
  const router = useRouter();
  const { user, logout, tasks, goals, exams } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTutorial, setShowTutorial] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+K to open search
  useHotkeys([
    {
      key: 'k',
      ctrl: true,
      handler: () => {
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      },
    },
    {
      key: 'Escape',
      handler: () => {
        setSearchOpen(false);
        setMobileSearchOpen(false);
        setSearchQuery('');
      },
    },
  ]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return { tasks: [], goals: [], exams: [] };
    const q = searchQuery.toLowerCase();
    return {
      tasks: tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 5),
      goals: goals.filter((g) => g.title.toLowerCase().includes(q)).slice(0, 3),
      exams: exams.filter((e) => e.title.toLowerCase().includes(q)).slice(0, 3),
    };
  }, [searchQuery, tasks, goals, exams]);

  const hasResults =
    searchResults.tasks.length > 0 ||
    searchResults.goals.length > 0 ||
    searchResults.exams.length > 0;

  const handleLogout = async () => {
    await logout();
    router.push('/auth/login');
  };

  const handleSearchSelect = (href: string) => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setSearchQuery('');
    router.push(href);
  };

  // Close search on outside click
  const searchContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    if (searchOpen) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [searchOpen]);

  // Focus mobile search input when opened
  useEffect(() => {
    if (mobileSearchOpen) {
      setTimeout(() => mobileSearchInputRef.current?.focus(), 100);
    }
  }, [mobileSearchOpen]);

  const renderSearchResults = () => {
    if (!searchQuery.trim()) return null;

    return (
      <div className="bg-card/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl overflow-hidden max-h-[60vh] overflow-y-auto">
        {!hasResults ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No results for &quot;{searchQuery}&quot;
          </div>
        ) : (
          <div className="py-2">
            {searchResults.tasks.length > 0 && (
              <div>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Tasks
                </div>
                {searchResults.tasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => handleSearchSelect('/tasks')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 active:bg-muted/70 transition-colors text-left min-h-[44px]"
                  >
                    <CheckSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.status === 'completed' ? 'Completed' : task.priority} priority
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchResults.goals.length > 0 && (
              <div>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Goals
                </div>
                {searchResults.goals.map((goal) => (
                  <button
                    key={goal.id}
                    onClick={() => handleSearchSelect('/goals')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 active:bg-muted/70 transition-colors text-left min-h-[44px]"
                  >
                    <Target className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{goal.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {goal.current_value}/{goal.target_value} {goal.unit}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchResults.exams.length > 0 && (
              <div>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Exams
                </div>
                {searchResults.exams.map((exam) => (
                  <button
                    key={exam.id}
                    onClick={() => handleSearchSelect('/exams')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 active:bg-muted/70 transition-colors text-left min-h-[44px]"
                  >
                    <GraduationCap className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{exam.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {exam.preparation_progress}% prepared
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <header className="h-14 sm:h-16 border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-30 transition-shadow">
        <div className="h-full flex items-center justify-between px-4 sm:px-8 gap-3 sm:gap-8">
          {/* Left side: Logo on mobile, hamburger hidden since we have bottom nav */}
          <div className="flex items-center gap-3 lg:hidden shrink-0">
            <img src="/logo.svg" alt="Orderly" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-base font-display tracking-tight">Orderly</span>
          </div>

          {/* Desktop search */}
          <div className="hidden sm:flex flex-1 max-w-md" ref={searchContainerRef}>
            <div className="relative w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
              <Input 
                ref={searchInputRef}
                placeholder="Search tasks, goals, exams..." 
                className="!pl-12 bg-muted/30 border-border/50 focus:bg-background/80 transition-colors"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!searchOpen) setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
                Ctrl K
              </kbd>

              {/* Desktop search dropdown */}
              {searchOpen && searchQuery.trim() && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="absolute top-full left-0 right-0 mt-2 z-50"
                >
                  {renderSearchResults()}
                </motion.div>
              )}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* Mobile search trigger */}
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden h-10 w-10"
              onClick={() => setMobileSearchOpen(true)}
            >
              <Search className="w-5 h-5" />
            </Button>

            {/* Help / Tutorial button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 hidden sm:flex text-muted-foreground hover:text-foreground"
              onClick={() => setShowTutorial(true)}
              title="App Tutorial"
            >
              <HelpCircle className="w-5 h-5" />
            </Button>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2 h-10">
                  <Avatar className="h-8 w-8 ring-2 ring-indigo-500/20 ring-offset-1 ring-offset-background transition-all hover:ring-indigo-500/40">
                    <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs">
                      {user?.full_name?.[0] || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium hidden md:inline-block">
                    {user?.full_name?.split(' ')[0] || 'User'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{user?.full_name || 'Demo User'}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user?.tasks_completed || 0} tasks completed • {user?.current_streak || 0} day streak
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="min-h-[44px] flex items-center">
                    <User className="w-4 h-4 mr-2" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="min-h-[44px] flex items-center">
                    <Settings className="w-4 h-4 mr-2" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-500 focus:text-red-500 cursor-pointer min-h-[44px]">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Mobile full-screen search overlay */}
      <AnimatePresence>
        {mobileSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-background sm:hidden"
          >
            <div className="flex flex-col h-full safe-area-top">
              {/* Search header */}
              <div className="flex items-center gap-3 px-4 h-14 border-b border-border/40">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={() => { setMobileSearchOpen(false); setSearchQuery(''); }}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={mobileSearchInputRef}
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="!pl-10 h-10 bg-muted/30 border-border/50"
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>

              {/* Search results */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {searchQuery.trim() ? (
                  renderSearchResults()
                ) : (
                  <div className="text-center text-sm text-muted-foreground pt-12">
                    <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Search your tasks, goals, and exams</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tutorial overlay (triggered from header) */}
      {showTutorial && (
        <Tutorial forceShow onComplete={() => setShowTutorial(false)} />
      )}
    </>
  );
}
