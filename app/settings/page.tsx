'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Sun, 
  Moon, 
  Monitor, 
  ChevronRight,
  Bell,
  Lock,
  Palette,
  User,
  Globe,
  Plug
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';

type Theme = 'light' | 'dark' | 'system';

const themeOptions: { value: Theme; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    value: 'light', 
    label: 'Light', 
    icon: <Sun className="w-5 h-5" />,
    description: 'Clean, bright interface for daytime use'
  },
  { 
    value: 'dark', 
    label: 'Dark', 
    icon: <Moon className="w-5 h-5" />,
    description: 'Easy on the eyes for nighttime studying'
  },
  { 
    value: 'system', 
    label: 'System', 
    icon: <Monitor className="w-5 h-5" />,
    description: 'Automatically match your device settings'
  },
];

const settingsSections = [
  {
    title: 'Account',
    icon: <User className="w-5 h-5" />,
    href: '/settings/account',
    description: 'Manage your profile and account details',
    disabled: true,
  },
  {
    title: 'Notifications',
    icon: <Bell className="w-5 h-5" />,
    href: '/settings/notifications',
    description: 'Configure alerts and reminders',
    disabled: true,
  },
  {
    title: 'Privacy & Security',
    icon: <Lock className="w-5 h-5" />,
    href: '/settings/privacy',
    description: 'Control your data and privacy settings',
    disabled: true,
  },
  {
    title: 'Integrations',
    icon: <Plug className="w-5 h-5" />,
    href: '/settings/integrations',
    description: 'Connect with Google Classroom and more',
    disabled: false,
  },
  {
    title: 'Language',
    icon: <Globe className="w-5 h-5" />,
    href: '/settings/language',
    description: 'Change language and regional settings',
    disabled: true,
  },
];

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useAppStore();
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      
      <div className="flex-1 flex flex-col">
        <Header />
        
        <main className="flex-1 p-6 overflow-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-4xl mx-auto space-y-6"
          >
            <div>
              <h1 className="text-2xl font-bold">Settings</h1>
              <p className="text-muted-foreground">Manage your app preferences</p>
            </div>
            
            {/* Appearance Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Palette className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Appearance</CardTitle>
                    <CardDescription>Customize how StudyFlow looks</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <label className="text-sm font-medium">Theme</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {themeOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={`
                          flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-all
                          ${theme === option.value 
                            ? 'border-primary bg-primary/5' 
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                          }
                        `}
                      >
                        <div className={`
                          p-3 rounded-full 
                          ${theme === option.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
                        `}>
                          {option.icon}
                        </div>
                        <div className="text-center">
                          <p className="font-medium">{option.label}</p>
                          <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Other Settings Sections */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">More Settings</CardTitle>
                <CardDescription>Configure other aspects of your account</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {settingsSections.map((section, index) => (
                    <div key={section.title}>
                      {section.disabled ? (
                        <div className="flex items-center justify-between p-4 opacity-50 cursor-not-allowed">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              {section.icon}
                            </div>
                            <div>
                              <p className="font-medium">{section.title}</p>
                              <p className="text-sm text-muted-foreground">{section.description}</p>
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">Coming soon</span>
                        </div>
                      ) : (
                        <Link 
                          href={section.href}
                          className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              {section.icon}
                            </div>
                            <div>
                              <p className="font-medium">{section.title}</p>
                              <p className="text-sm text-muted-foreground">{section.description}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
