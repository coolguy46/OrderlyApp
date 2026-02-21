'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useHotkeys } from '@/lib/useHotkeys';
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
} from 'lucide-react';
import Link from 'next/link';

interface HeaderProps {
  onMobileMenuToggle?: () => void;
}

export function Header({ onMobileMenuToggle }: HeaderProps) {
  const router = useRouter();
  const { user, logout, tasks, goals, exams } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <header className="h-16 border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-30">
      <div className="h-full flex items-center justify-between px-4 sm:px-8 gap-4 sm:gap-8">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={onMobileMenuToggle}
        >
          <Menu className="w-5 h-5" />
        </Button>

        {/* Search */}
        <div className="flex-1 max-w-md" ref={searchContainerRef}>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <Input 
              ref={searchInputRef}
              placeholder="Search tasks, goals, exams..." 
              className="!pl-12 bg-background/50 border-border/50"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!searchOpen) setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
              Ctrl K
            </kbd>

            {/* Search dropdown */}
            {searchOpen && searchQuery.trim() && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50 max-h-[400px] overflow-y-auto">
                {!hasResults ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No results for &quot;{searchQuery}&quot;
                  </div>
                ) : (
                  <div className="py-2">
                    {searchResults.tasks.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Tasks
                        </div>
                        {searchResults.tasks.map((task) => (
                          <button
                            key={task.id}
                            onClick={() => handleSearchSelect('/tasks')}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
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
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Goals
                        </div>
                        {searchResults.goals.map((goal) => (
                          <button
                            key={goal.id}
                            onClick={() => handleSearchSelect('/goals')}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
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
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Exams
                        </div>
                        {searchResults.exams.map((exam) => (
                          <button
                            key={exam.id}
                            onClick={() => handleSearchSelect('/exams')}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
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
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar className="h-8 w-8">
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
                <Link href="/profile">
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-500 focus:text-red-500 cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
