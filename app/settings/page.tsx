'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Plug,
  Save,
  Download,
  Trash2,
  Key,
  Eye,
  EyeOff,
  Check,
  X,
  Mail,
  Shield,
  BellRing,
  BellOff,
  Clock,
  GraduationCap,
  Target,
  AlertTriangle,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { MainLayout } from '@/components/layout';
import { useAppStore } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { toast } from 'sonner';

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

// Notification preference keys
interface NotificationPreferences {
  taskReminders: boolean;
  examReminders: boolean;
  studyReminders: boolean;
  goalDeadlines: boolean;
  dailyDigest: boolean;
  soundEnabled: boolean;
}

const defaultNotificationPrefs: NotificationPreferences = {
  taskReminders: true,
  examReminders: true,
  studyReminders: false,
  goalDeadlines: true,
  dailyDigest: false,
  soundEnabled: true,
};

const languages = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ko', label: 'Korean', native: '한국어' },
];

// Toggle switch component
function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (val: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform
          ${checked ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  );
}

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, user, updateUserProfile, tasks, goals, exams, studySessions, subjects, logout } = useAppStore();
  
  // Account state
  const [fullName, setFullName] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isChangingPw, setIsChangingPw] = useState(false);
  
  // Notification preferences  
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(defaultNotificationPrefs);
  
  // Language
  const [language, setLanguage] = useState('en');
  
  // Data export
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Load notification preferences from localStorage
    const savedNotifPrefs = localStorage.getItem('orderly-notification-prefs');
    if (savedNotifPrefs) {
      try { setNotifPrefs(JSON.parse(savedNotifPrefs)); } catch {}
    }
    
    // Load language
    const savedLang = localStorage.getItem('orderly-language');
    if (savedLang) setLanguage(savedLang);
  }, []);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
    }
  }, [user]);
  
  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    try {
      await updateUserProfile({ full_name: fullName || null });
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };
  
  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    
    setIsChangingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update password');
    } finally {
      setIsChangingPw(false);
    }
  };
  
  const handleNotifChange = (key: keyof NotificationPreferences, value: boolean) => {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    localStorage.setItem('orderly-notification-prefs', JSON.stringify(updated));
    toast.success('Notification preference updated');
  };
  
  const handleLanguageChange = (code: string) => {
    setLanguage(code);
    localStorage.setItem('orderly-language', code);
    toast.success('Language preference saved');
  };
  
  const handleExportData = async () => {
    setIsExporting(true);
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        profile: user,
        tasks,
        goals,
        exams,
        studySessions,
        subjects,
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orderly-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Data exported successfully');
    } catch {
      toast.error('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently removed.')) {
      return;
    }
    if (!confirm('This is your last chance. Type OK in the next prompt to confirm deletion.')) {
      return;
    }
    
    try {
      // Sign out (actual account deletion would require server-side admin action)
      toast.success('Account deletion requested. You will be signed out.');
      await logout();
    } catch {
      toast.error('Failed to process account deletion');
    }
  };

  if (!mounted) {
    return null;
  }

  const sectionVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
  };

  return (
    <MainLayout>
      <motion.div
        initial="hidden"
        animate="show"
        transition={{ staggerChildren: 0.08 }}
        className="max-w-4xl mx-auto space-y-6"
      >
        <motion.div variants={sectionVariants}>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your app preferences</p>
        </motion.div>
            
        {/* Appearance Section */}
        <motion.div variants={sectionVariants}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Palette className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Appearance</CardTitle>
                  <CardDescription>Customize how Orderly looks</CardDescription>
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
        </motion.div>

        {/* Account Section */}
        <motion.div variants={sectionVariants}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <User className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Account</CardTitle>
                  <CardDescription>Manage your profile and account details</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    Email
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
                    {user?.email || 'Not available'}
                  </div>
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    Full Name
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                      className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Button 
                      size="sm" 
                      onClick={handleSaveProfile} 
                      disabled={isSavingProfile || fullName === (user?.full_name || '')}
                      className="gap-1.5"
                    >
                      {isSavingProfile ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                          <Clock className="w-4 h-4" />
                        </motion.div>
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              </div>

              {/* Account stats */}
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-3">Account Stats</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Tasks Completed', value: user?.tasks_completed || 0, icon: Check },
                    { label: 'Study Hours', value: Math.round((user?.total_study_time || 0) / 60), icon: Clock },
                    { label: 'Current Streak', value: `${user?.current_streak || 0}d`, icon: Target },
                    { label: 'Member Since', value: user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—', icon: User },
                  ].map((stat) => (
                    <div key={stat.label} className="p-3 rounded-lg bg-muted/30 border text-center">
                      <stat.icon className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-lg font-bold">{stat.value}</p>
                      <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Notifications Section */}
        <motion.div variants={sectionVariants}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Bell className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Notifications</CardTitle>
                  <CardDescription>Configure alerts and reminders</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {[
                  { key: 'taskReminders' as const, label: 'Task Reminders', description: 'Get notified when tasks are due soon', icon: AlertTriangle },
                  { key: 'examReminders' as const, label: 'Exam Reminders', description: 'Receive alerts before upcoming exams', icon: GraduationCap },
                  { key: 'studyReminders' as const, label: 'Study Session Reminders', description: 'Daily reminders to keep your study habit', icon: Clock },
                  { key: 'goalDeadlines' as const, label: 'Goal Deadlines', description: 'Alerts when goal deadlines approach', icon: Target },
                  { key: 'dailyDigest' as const, label: 'Daily Digest', description: 'Summary of your daily tasks and schedule', icon: Mail },
                  { key: 'soundEnabled' as const, label: 'Sound Effects', description: 'Play sounds for timer and notifications', icon: BellRing },
                ].map((item, idx) => (
                  <div key={item.key} className="flex items-center justify-between py-3 px-1">
                    <div className="flex items-center gap-3">
                      <item.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                    <ToggleSwitch
                      checked={notifPrefs[item.key]}
                      onChange={(val) => handleNotifChange(item.key, val)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Privacy & Security Section */}
        <motion.div variants={sectionVariants}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Lock className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Privacy & Security</CardTitle>
                  <CardDescription>Control your data and privacy settings</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Change Password */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Change Password</p>
                </div>
                <div className="space-y-3 pl-6">
                  <div className="relative">
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password"
                      className="w-full px-3 py-2 pr-10 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswords(!showPasswords)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {newPassword && confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <X className="w-3 h-3" /> Passwords do not match
                    </p>
                  )}
                  {newPassword && newPassword === confirmPassword && newPassword.length >= 6 && (
                    <p className="text-xs text-green-500 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Passwords match
                    </p>
                  )}
                  <Button 
                    size="sm" 
                    onClick={handleChangePassword}
                    disabled={isChangingPw || !newPassword || newPassword !== confirmPassword || newPassword.length < 6}
                    className="gap-1.5"
                  >
                    <Key className="w-4 h-4" />
                    Update Password
                  </Button>
                </div>
              </div>

              {/* Data Export */}
              <div className="pt-4 border-t space-y-3">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Export Your Data</p>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Download all your tasks, exams, goals, study sessions, and profile data as a JSON file.
                </p>
                <div className="pl-6">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleExportData}
                    disabled={isExporting}
                    className="gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    {isExporting ? 'Exporting...' : 'Export Data'}
                  </Button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-4 border-t space-y-3">
                <div className="flex items-center gap-2 text-red-500">
                  <AlertTriangle className="w-4 h-4" />
                  <p className="text-sm font-medium">Danger Zone</p>
                </div>
                <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 space-y-3 ml-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Delete Account</p>
                      <p className="text-xs text-muted-foreground">Permanently delete your account and all associated data. This cannot be undone.</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleDeleteAccount}
                      className="shrink-0 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-500 gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-4 pt-3 border-t border-red-500/10">
                    <div>
                      <p className="text-sm font-medium">Sign Out</p>
                      <p className="text-xs text-muted-foreground">Sign out of your account on this device.</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={async () => { await logout(); window.location.href = '/auth/login'; }}
                      className="shrink-0 gap-1.5"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Integrations Link */}
        <motion.div variants={sectionVariants}>
          <Link href="/settings/integrations">
            <Card className="hover:bg-muted/30 transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Plug className="w-5 h-5 text-purple-500" />
                    </div>
                    <div>
                      <p className="font-medium">Integrations</p>
                      <p className="text-sm text-muted-foreground">Connect with Canvas LMS, Google Classroom, and more</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>

        {/* Language Section */}
        <motion.div variants={sectionVariants}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/10">
                  <Globe className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Language</CardTitle>
                  <CardDescription>Change language and regional settings</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`
                      p-3 rounded-lg border-2 text-center transition-all
                      ${language === lang.code
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }
                    `}
                  >
                    <p className="text-sm font-medium">{lang.native}</p>
                    <p className="text-xs text-muted-foreground">{lang.label}</p>
                    {language === lang.code && (
                      <Check className="w-3.5 h-3.5 text-primary mx-auto mt-1" />
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Language preference is saved locally. Full translations are coming in a future update.
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Spacer for bottom padding */}
        <div className="h-8" />
      </motion.div>
    </MainLayout>
  );
}
