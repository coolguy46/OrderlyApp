'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Input } from '@/components/ui';
import { CanvasAssignment } from '@/lib/integrations/canvas';
import { useCanvasSyncSupabase, formatTimeUntilSync, formatLastSync } from '@/lib/integrations/useCanvasSyncSupabase';
import { useAppStore } from '@/lib/store';
import * as db from '@/lib/supabase/services';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Link2,
  Unlink,
  RefreshCw,
  Check,
  ExternalLink,
  BookOpen,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Calendar,
  Clock,
  Settings,
  Zap,
  ZapOff,
  Timer,
  Trash2,
} from 'lucide-react';

// Canvas icon component
function CanvasIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18L18.82 8 12 11.82 5.18 8 12 4.18zM5 9.5l6.5 3.61v7.71L5 17.21V9.5zm8.5 11.32v-7.71L20 9.5v7.71l-6.5 3.61z" />
    </svg>
  );
}

export default function IntegrationsPage() {
  const { addTask, tasks, user, refreshData } = useAppStore();
  const [removedCount, setRemovedCount] = useState(0);

  // Canvas live sync hook with Supabase
  const {
    assignments: canvasAssignments,
    isLoading: isCanvasLoading,
    isSyncing: isCanvasSyncing,
    error: canvasError,
    lastSyncAt,
    nextSyncAt,
    settings: canvasSettings,
    syncNow,
    setIcalUrl,
    toggleAutoSync,
    setSyncInterval,
    clearData,
    removedAssignmentsCount,
  } = useCanvasSyncSupabase({
    userId: user?.id || null,
    defaultInterval: 15, // 15 minutes
    onSyncComplete: async (allAssignments, removed) => {
      if (!user) return;
      
      let importedCount = 0;
      setRemovedCount(removed);
      
      // Get existing Canvas task external IDs from the database
      const existingCanvasExternalIds = new Set(
        tasks
          .filter(t => t.source === 'canvas' && t.external_id)
          .map(t => t.external_id)
      );
      
      for (const assignment of allAssignments) {
        if (!assignment.dueDate) continue;
        const dueDate = new Date(assignment.dueDate);
        if (dueDate < new Date()) continue;
        
        // Skip if already exists in the store (by external_id)
        if (existingCanvasExternalIds.has(assignment.id)) continue;

        // Create task in Supabase
        await addTask({
          user_id: user.id,
          title: `[Canvas] ${assignment.title}`,
          description: assignment.description || `Course: ${assignment.courseName}`,
          priority: assignment.type === 'exam' ? 'high' : 'medium',
          status: 'pending',
          due_date: dueDate.toISOString(),
          subject_id: null,
          completed_at: null,
          source: 'canvas',
          external_id: assignment.id,
          external_url: assignment.url || null,
          course_name: assignment.courseName || null,
          assignment_type: assignment.type || 'assignment',
        });
        importedCount++;
      }
      
      if (importedCount > 0 || removed > 0) {
        console.log(`Canvas sync: imported ${importedCount} new assignments, removed ${removed} submitted/deleted assignments`);
        // Refresh data to reflect changes
        await refreshData();
      }
    },
  });

  // Live countdown display
  const [countdown, setCountdown] = useState('');
  const [lastSyncDisplay, setLastSyncDisplay] = useState('');

  // Update countdown every second
  useEffect(() => {
    const updateDisplays = () => {
      setCountdown(formatTimeUntilSync(nextSyncAt));
      setLastSyncDisplay(formatLastSync(lastSyncAt));
    };

    updateDisplays();
    const interval = setInterval(updateDisplays, 1000);
    return () => clearInterval(interval);
  }, [nextSyncAt, lastSyncAt]);

  // Canvas URL input state (separate from saved settings)
  const [canvasUrlInput, setCanvasUrlInput] = useState('');

  // Sync input with saved URL
  useEffect(() => {
    if (canvasSettings.icalUrl && !canvasUrlInput) {
      setCanvasUrlInput(canvasSettings.icalUrl);
    }
  }, [canvasSettings.icalUrl]);

  const handleCanvasConnect = () => {
    if (!canvasUrlInput.trim()) return;
    setIcalUrl(canvasUrlInput);
    // Trigger initial sync after setting URL
    setTimeout(() => syncNow(), 100);
  };



  return (
    <MainLayout>
      <div className="space-y-8 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your favorite apps to automatically import tasks and deadlines
          </p>
        </div>

        {/* Canvas Integration Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-orange-500/10 relative">
                  <CanvasIcon className="w-8 h-8 text-orange-500" />
                  {canvasSettings.syncEnabled && canvasSettings.icalUrl && (
                    <motion.div
                      className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                </div>
                <div>
                  <CardTitle className="text-lg">LMS Import</CardTitle>
                  <CardDescription>
                    Import assignments from your LMS calendar feed
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canvasSettings.icalUrl && (
                  <Badge 
                    variant="outline" 
                    className={`${canvasSettings.syncEnabled ? 'border-green-500 text-green-500' : 'border-gray-500 text-gray-500'}`}
                  >
                    {canvasSettings.syncEnabled ? (
                      <>
                        <Zap className="w-3 h-3 mr-1" />
                        Live Sync
                      </>
                    ) : (
                      <>
                        <ZapOff className="w-3 h-3 mr-1" />
                        Paused
                      </>
                    )}
                  </Badge>
                )}
                <Badge variant={canvasAssignments.length > 0 ? 'default' : 'secondary'} 
                  className={canvasAssignments.length > 0 ? 'bg-orange-500' : ''}>
                  {canvasAssignments.length > 0 ? 'Connected' : 'Not Connected'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {isCanvasLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : canvasSettings.icalUrl ? (
              <>
                {/* Connected State with Live Sync */}
                <div className="space-y-4">
                  {/* Sync Status Bar */}
                  <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${canvasSettings.syncEnabled ? 'bg-green-500/10' : 'bg-gray-500/10'}`}>
                        <Clock className={`w-5 h-5 ${canvasSettings.syncEnabled ? 'text-green-400' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {isCanvasSyncing ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Syncing...
                            </span>
                          ) : canvasSettings.syncEnabled ? (
                            countdown
                          ) : (
                            'Auto-sync paused'
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{lastSyncDisplay}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={syncNow} 
                        disabled={isCanvasSyncing}
                      >
                        <RefreshCw className={`w-4 h-4 ${isCanvasSyncing ? 'animate-spin' : ''}`} />
                        Sync Now
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleAutoSync}
                        className={canvasSettings.syncEnabled ? 'text-green-400 border-green-500/50' : 'text-gray-400'}
                      >
                        {canvasSettings.syncEnabled ? (
                          <>
                            <Zap className="w-4 h-4" />
                            On
                          </>
                        ) : (
                          <>
                            <ZapOff className="w-4 h-4" />
                            Off
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Sync Interval Settings */}
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-border/30">
                    <Timer className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm">Sync every:</span>
                    <div className="flex items-center gap-2">
                      {[5, 15, 30, 60].map((mins) => (
                        <Button
                          key={mins}
                          variant={canvasSettings.autoSyncInterval === mins ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSyncInterval(mins)}
                          className="min-w-[60px]"
                        >
                          {mins}m
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Error Display */}
                  <AnimatePresence>
                    {canvasError && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30"
                      >
                        <AlertCircle className="w-5 h-5 text-red-400" />
                        <span className="text-red-400">{canvasError}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Assignment Summary */}
                  {canvasAssignments.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        Tracking {canvasAssignments.length} assignments
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          { 
                            label: 'Total', 
                            count: canvasAssignments.length,
                            color: 'text-blue-400'
                          },
                          { 
                            label: 'Exams', 
                            count: canvasAssignments.filter((a: CanvasAssignment) => a.type === 'exam').length,
                            color: 'text-red-400'
                          },
                          { 
                            label: 'Upcoming', 
                            count: canvasAssignments.filter((a: CanvasAssignment) => a.status === 'upcoming').length,
                            color: 'text-green-400'
                          },
                          { 
                            label: 'Courses', 
                            count: new Set(canvasAssignments.map((a: CanvasAssignment) => a.courseName)).size,
                            color: 'text-purple-400'
                          },
                        ].map((stat) => (
                          <div key={stat.label} className="p-4 rounded-xl bg-muted/30 border border-border/50">
                            <p className="text-xs text-muted-foreground">{stat.label}</p>
                            <p className={`text-2xl font-bold ${stat.color}`}>{stat.count}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Disconnect Button */}
                  <div className="flex justify-end pt-4 border-t border-border/30">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearData}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                      Disconnect Canvas
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Not Connected State */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Canvas Calendar Feed URL</label>
                    <div className="flex gap-2">
                      <Input
                        type="url"
                        placeholder="https://canvas.instructure.com/feeds/calendars/user_xxx.ics"
                        value={canvasUrlInput}
                        onChange={(e) => setCanvasUrlInput(e.target.value)}
                        className="flex-1"
                      />
                      <Button onClick={handleCanvasConnect} disabled={!canvasUrlInput.trim()}>
                        <Zap className="w-4 h-4" />
                        Connect
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      To get your Canvas calendar URL: Go to Canvas → Calendar → Calendar Feed → Copy the URL
                    </p>
                  </div>
                </div>

                {/* Features */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border/50">
                  {[
                    { icon: Zap, title: 'Live Sync', desc: 'Auto-updates every 5-60 min' },
                    { icon: RefreshCw, title: 'Real-time', desc: 'See changes instantly' },
                    { icon: Check, title: 'Auto Import', desc: 'Tasks created automatically' },
                  ].map((feature) => (
                    <div key={feature.title} className="flex items-start gap-3 p-4">
                      <div className="p-2 rounded-lg bg-orange-500/10">
                        <feature.icon className="w-4 h-4 text-orange-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{feature.title}</p>
                        <p className="text-xs text-muted-foreground">{feature.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* More Integrations Coming Soon */}
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Link2 className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              More integrations coming soon...
            </p>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
