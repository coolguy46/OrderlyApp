'use client';

import { useState, useEffect, useMemo } from 'react';
import { Goal, GoalType, Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { 
  Card, 
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Progress,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { CircularProgress, ConfirmDialog } from '@/components/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CollegePrepTab } from './CollegePrep';
import { motion, AnimatePresence } from 'framer-motion';
import { getDaysUntil, getProgressPercentage, cn } from '@/lib/utils';
import {
  Target,
  Plus,
  Clock,
  Trophy,
  Trash2,
  Edit3,
  CheckCircle2,
  TrendingUp,
  Zap,
  BookOpen,
  Briefcase,
  Code,
  Award,
  Star,
  FileText,
  GraduationCap,
  RefreshCw,
  Link2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// ─────────────────── GoalCard ───────────────────

interface GoalCardProps {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  linkedTasks?: Task[];
}

function GoalCard({ goal, onEdit, linkedTasks = [] }: GoalCardProps) {
  const { updateGoal, deleteGoal } = useAppStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const progress = getProgressPercentage(goal.current_value, goal.target_value);
  const daysLeft = goal.deadline ? getDaysUntil(goal.deadline) : null;
  const isCompleted = goal.status === 'completed' || progress >= 100;

  const handleIncrement = async () => {
    const newValue = Math.min(goal.current_value + 1, goal.target_value);
    await updateGoal(goal.id, {
      current_value: newValue,
      status: newValue >= goal.target_value ? 'completed' : 'active',
    });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -30 }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <Card className={cn('group hover:shadow-md transition-shadow glow-border', isCompleted && 'border-green-500/30')}>
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <CircularProgress
              value={goal.current_value}
              max={goal.target_value}
              size={72}
              strokeWidth={5}
              animated
              color={isCompleted ? '#10b981' : '#6366f1'}
            >
              {isCompleted ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </motion.div>
              ) : (
                <span className="text-sm font-bold">{progress}%</span>
              )}
            </CircularProgress>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <h3 className={cn('font-semibold text-sm', isCompleted && 'text-green-400')}>{goal.title}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className={cn(
                      'text-[10px]',
                      goal.goal_type === 'short_term'
                        ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                    )}>
                      {goal.goal_type === 'short_term' ? 'Short Term' : 'Long Term'}
                    </Badge>
                    {daysLeft !== null && daysLeft >= 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {daysLeft === 0 ? 'Today' : `${daysLeft}d left`}
                      </span>
                    )}
                    {linkedTasks.length > 0 && (
                      <span className="text-xs text-indigo-400 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        {linkedTasks.length} task{linkedTasks.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-sm" onClick={() => onEdit(goal)}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} className="text-red-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {goal.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{goal.description}</p>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{goal.current_value} / {goal.target_value} {goal.unit}</span>
                  {!isCompleted && (
                    <Button size="sm" variant="ghost" onClick={handleIncrement} className="h-6 text-xs gap-1 px-2">
                      <Plus className="w-3 h-3" /> Add 1
                    </Button>
                  )}
                </div>
                <Progress value={progress} className={cn('h-1.5', isCompleted && '[&>div]:bg-green-500')} />
              </div>

              {linkedTasks.length > 0 && (
                <button onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? 'Hide' : 'Show'} linked tasks
                </button>
              )}
              {expanded && linkedTasks.length > 0 && (
                <div className="space-y-1 mt-1">
                  {linkedTasks.slice(0, 5).map(t => (
                    <div key={t.id} className={cn('text-xs px-2 py-1 rounded-lg flex items-center gap-2', t.status === 'completed' ? 'bg-green-500/10 text-green-400' : 'bg-muted/50 text-muted-foreground')}>
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{t.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Goal"
        description={`Delete "${goal.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteGoal(goal.id)}
      />
    </motion.div>
  );
}

// ─────────────────── GoalForm ───────────────────

interface GoalFormProps {
  isOpen: boolean;
  onClose: () => void;
  goal?: Goal | null;
}

function GoalForm({ isOpen, onClose, goal }: GoalFormProps) {
  const { addGoal, updateGoal, user } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetValue, setTargetValue] = useState('10');
  const [currentValue, setCurrentValue] = useState('0');
  const [unit, setUnit] = useState('tasks');
  const [goalType, setGoalType] = useState<GoalType>('short_term');
  const [deadline, setDeadline] = useState('');
  const [autoTrack, setAutoTrack] = useState(false);

  useEffect(() => {
    if (goal) {
      setTitle(goal.title);
      setDescription(goal.description || '');
      setTargetValue(goal.target_value.toString());
      setCurrentValue(goal.current_value.toString());
      setUnit(goal.unit);
      setGoalType(goal.goal_type);
      setDeadline(goal.deadline ? new Date(goal.deadline).toISOString().split('T')[0] : '');
    } else {
      resetForm();
    }
  }, [goal, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const goalData = {
      user_id: user?.id || '',
      title,
      description: description || null,
      target_value: parseInt(targetValue) || 10,
      current_value: parseInt(currentValue) || 0,
      unit,
      goal_type: goalType,
      deadline: deadline ? new Date(deadline + 'T00:00:00').toISOString() : null,
      status: 'active' as const,
    };
    if (goal) {
      await updateGoal(goal.id, goalData);
    } else {
      await addGoal(goalData);
      // If auto-track, save the link in localStorage
      if (autoTrack) {
        const links = JSON.parse(localStorage.getItem('goalAutoTrackUnits') || '{}');
        links[title] = unit;
        localStorage.setItem('goalAutoTrackUnits', JSON.stringify(links));
      }
    }
    onClose();
  };

  const resetForm = () => {
    setTitle(''); setDescription(''); setTargetValue('10');
    setCurrentValue('0'); setUnit('tasks'); setGoalType('short_term');
    setDeadline(''); setAutoTrack(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit Goal' : 'Create New Goal'}</DialogTitle>
          <DialogDescription>{goal ? 'Update your goal details.' : 'Set a new goal to track your progress.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Goal Title</Label>
            <Input placeholder="e.g., Complete 20 assignments" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea placeholder="Describe your goal..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Target</Label>
              <Input type="number" min="1" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Current</Label>
              <Input type="number" min="0" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Input placeholder="tasks, hours..." value={unit} onChange={(e) => setUnit(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Goal Type</Label>
              <Select value={goalType} onValueChange={(v) => setGoalType(v as GoalType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_term">Short Term</SelectItem>
                  <SelectItem value="long_term">Long Term</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Deadline</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          {/* Auto-track toggle */}
          {!goal && unit === 'tasks' && (
            <div className="flex items-center gap-3 p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <Zap className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Auto-track from completed tasks</p>
                <p className="text-xs text-muted-foreground">Progress updates automatically when you complete tasks</p>
              </div>
              <button
                type="button"
                onClick={() => setAutoTrack(!autoTrack)}
                className={cn('w-10 h-5 rounded-full transition-colors relative', autoTrack ? 'bg-indigo-500' : 'bg-muted')}
              >
                <motion.div animate={{ x: autoTrack ? 20 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow" />
              </button>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1">{goal ? 'Update Goal' : 'Create Goal'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── Auto-Track Goals Tab ───────────────────

function AutoTrackTab() {
  const { goals, tasks, updateGoal } = useAppStore();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Goals with "tasks" unit are auto-trackable
  const trackableGoals = goals.filter(g => g.unit === 'tasks' && g.status === 'active');
  const completedTasksCount = tasks.filter(t => t.status === 'completed').length;

  const handleAutoSync = async () => {
    setSyncing(true);
    try {
      for (const goal of trackableGoals) {
        // Calculate new value: number of completed tasks, capped at target
        const newValue = Math.min(completedTasksCount, goal.target_value);
        if (newValue !== goal.current_value) {
          await updateGoal(goal.id, {
            current_value: newValue,
            status: newValue >= goal.target_value ? 'completed' : 'active',
          });
        }
      }
      const now = new Date().toLocaleTimeString();
      setLastSync(now);
      localStorage.setItem('goalLastSync', now);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('goalLastSync');
    if (saved) setLastSync(saved);
  }, []);

  // Task completion stats
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;

  const statRows = [
    { label: 'Total Tasks', value: totalTasks, color: 'text-foreground' },
    { label: 'Completed', value: completedTasks, color: 'text-green-400' },
    { label: 'In Progress', value: inProgressTasks, color: 'text-blue-400' },
    { label: 'Pending', value: pendingTasks, color: 'text-yellow-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statRows.map(s => (
          <Card key={s.label} className="glow-border">
            <CardContent className="p-4 text-center">
              <p className={cn('text-3xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Auto-sync panel */}
      <Card className="glow-border border-indigo-500/20 bg-indigo-500/5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-xl">
                <Zap className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-semibold">Auto-Track Goals</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Sync your goals' progress with completed task counts. Goals with unit "tasks" will be updated automatically.
                </p>
                {lastSync && (
                  <p className="text-xs text-muted-foreground mt-1">Last synced: {lastSync}</p>
                )}
              </div>
            </div>
            <Button onClick={handleAutoSync} disabled={syncing || trackableGoals.length === 0} size="sm" className="shrink-0 gap-2">
              <RefreshCw className={cn('w-4 h-4', syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </Button>
          </div>

          {trackableGoals.length === 0 && (
            <div className="mt-4 p-3 bg-muted/50 rounded-xl text-sm text-muted-foreground text-center">
              No auto-trackable goals found. Create a goal with unit "tasks" to enable auto-tracking.
            </div>
          )}

          {trackableGoals.length > 0 && (
            <div className="mt-4 space-y-3">
              {trackableGoals.map(goal => {
                const progress = getProgressPercentage(goal.current_value, goal.target_value);
                const newValue = Math.min(completedTasksCount, goal.target_value);
                const willUpdate = newValue !== goal.current_value;
                return (
                  <div key={goal.id} className="p-3 bg-background/60 rounded-xl border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{goal.title}</span>
                      {willUpdate && (
                        <Badge className="text-[10px] bg-indigo-500/20 text-indigo-400 border-indigo-500/30">
                          {goal.current_value} → {newValue}
                        </Badge>
                      )}
                    </div>
                    <Progress value={progress} className="h-1.5" />
                    <p className="text-xs text-muted-foreground mt-1">{goal.current_value} / {goal.target_value} tasks completed</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent completions */}
      {completedTasks > 0 && (
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            Recently Completed Tasks
          </h3>
          <div className="space-y-2">
            {tasks.filter(t => t.status === 'completed').slice(0, 8).map(task => (
              <div key={task.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                <span className="flex-1 truncate">{task.title}</span>
                {task.completed_at && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(task.completed_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────── Resume / Portfolio Tab ───────────────────

interface ResumeItem {
  id: string;
  category: 'skills' | 'experience' | 'projects' | 'certifications' | 'education';
  title: string;
  subtitle?: string;
  description?: string;
  date?: string;
  level?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  completed: boolean;
}

const categoryConfig = {
  skills: { icon: Code, label: 'Skills', color: 'blue', gradient: 'from-blue-500/10 to-blue-500/5' },
  experience: { icon: Briefcase, label: 'Experience', color: 'purple', gradient: 'from-purple-500/10 to-purple-500/5' },
  projects: { icon: FileText, label: 'Projects', color: 'indigo', gradient: 'from-indigo-500/10 to-indigo-500/5' },
  certifications: { icon: Award, label: 'Certifications', color: 'amber', gradient: 'from-amber-500/10 to-amber-500/5' },
  education: { icon: GraduationCap, label: 'Education', color: 'green', gradient: 'from-green-500/10 to-green-500/5' },
};

const levelConfig = {
  beginner: { label: 'Beginner', color: 'bg-gray-500/20 text-gray-400' },
  intermediate: { label: 'Intermediate', color: 'bg-blue-500/20 text-blue-400' },
  advanced: { label: 'Advanced', color: 'bg-indigo-500/20 text-indigo-400' },
  expert: { label: 'Expert', color: 'bg-purple-500/20 text-purple-400' },
};

function ResumeTab() {
  const [items, setItems] = useState<ResumeItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<ResumeItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<ResumeItem['category'] | 'all'>('all');
  const [formData, setFormData] = useState<Partial<ResumeItem>>({
    category: 'skills',
    title: '',
    subtitle: '',
    description: '',
    date: '',
    level: 'intermediate',
    completed: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem('resumeItems');
    if (saved) {
      try { setItems(JSON.parse(saved)); } catch {}
    }
  }, []);

  const saveItems = (newItems: ResumeItem[]) => {
    setItems(newItems);
    localStorage.setItem('resumeItems', JSON.stringify(newItems));
  };

  const handleSave = () => {
    if (!formData.title) return;
    if (editingItem) {
      saveItems(items.map(i => i.id === editingItem.id ? { ...editingItem, ...formData } as ResumeItem : i));
    } else {
      const newItem: ResumeItem = {
        id: crypto.randomUUID(),
        category: formData.category || 'skills',
        title: formData.title || '',
        subtitle: formData.subtitle,
        description: formData.description,
        date: formData.date,
        level: formData.level,
        completed: formData.completed || false,
      };
      saveItems([...items, newItem]);
    }
    setShowForm(false);
    setEditingItem(null);
    setFormData({ category: 'skills', title: '', subtitle: '', description: '', date: '', level: 'intermediate', completed: false });
  };

  const handleDelete = (id: string) => {
    saveItems(items.filter(i => i.id !== id));
  };

  const handleToggle = (id: string) => {
    saveItems(items.map(i => i.id === id ? { ...i, completed: !i.completed } : i));
  };

  const openEdit = (item: ResumeItem) => {
    setEditingItem(item);
    setFormData(item);
    setShowForm(true);
  };

  const filteredItems = activeCategory === 'all' ? items : items.filter(i => i.category === activeCategory);
  const completedCount = items.filter(i => i.completed).length;
  const completionRate = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="glow-border bg-gradient-to-br from-indigo-500/10 to-indigo-500/5">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{items.length}</p>
            <p className="text-xs text-muted-foreground">Total Items</p>
          </CardContent>
        </Card>
        <Card className="glow-border bg-gradient-to-br from-green-500/10 to-green-500/5">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-400">{completedCount}</p>
            <p className="text-xs text-muted-foreground">Achieved</p>
          </CardContent>
        </Card>
        <Card className="glow-border bg-gradient-to-br from-amber-500/10 to-amber-500/5">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">{completionRate}%</p>
            <p className="text-xs text-muted-foreground">Complete</p>
          </CardContent>
        </Card>
      </div>

      {/* Category filter + Add button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap bg-muted/50 rounded-xl p-1.5">
          <button
            onClick={() => setActiveCategory('all')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', activeCategory === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            All
          </button>
          {(Object.keys(categoryConfig) as ResumeItem['category'][]).map(cat => {
            const cfg = categoryConfig[cat];
            const Icon = cfg.icon;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5', activeCategory === cat ? `bg-${cfg.color}-500/20 text-${cfg.color}-400 border border-${cfg.color}-500/30` : 'text-muted-foreground hover:text-foreground')}
              >
                <Icon className="w-3 h-3" />
                {cfg.label}
              </button>
            );
          })}
        </div>
        <Button onClick={() => { setEditingItem(null); setFormData({ category: 'skills', title: '', subtitle: '', description: '', date: '', level: 'intermediate', completed: false }); setShowForm(true); }} size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Item
        </Button>
      </div>

      {/* Items grid */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-16">
          <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity }} className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-muted-foreground" />
          </motion.div>
          <p className="font-medium">No resume items yet</p>
          <p className="text-sm text-muted-foreground mt-1">Track your skills, experience, and projects</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredItems.map(item => {
              const cfg = categoryConfig[item.category];
              const Icon = cfg.icon;
              return (
                <motion.div key={item.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Card className={cn('group glow-border hover:shadow-md transition-all', item.completed && 'border-green-500/30 bg-green-500/5')}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={cn('p-2 rounded-xl shrink-0 bg-gradient-to-br', cfg.gradient)}>
                          <Icon className={`w-4 h-4 text-${cfg.color}-400`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className={cn('font-semibold text-sm', item.completed && 'text-green-400 line-through opacity-70')}>{item.title}</h4>
                              {item.subtitle && <p className="text-xs text-muted-foreground">{item.subtitle}</p>}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Badge variant="outline" className={cn('text-[10px]', `bg-${cfg.color}-500/10 text-${cfg.color}-400 border-${cfg.color}-500/20`)}>
                              {cfg.label}
                            </Badge>
                            {item.level && item.category === 'skills' && (
                              <Badge variant="outline" className={cn('text-[10px]', levelConfig[item.level].color)}>
                                {levelConfig[item.level].label}
                              </Badge>
                            )}
                            {item.date && <span className="text-[10px] text-muted-foreground">{item.date}</span>}
                          </div>
                          <button
                            onClick={() => handleToggle(item.id)}
                            className={cn('mt-2 flex items-center gap-1.5 text-xs transition-colors', item.completed ? 'text-green-400' : 'text-muted-foreground hover:text-foreground')}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {item.completed ? 'Achieved' : 'Mark as achieved'}
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add Resume Item'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData(p => ({ ...p, category: v as ResumeItem['category'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(categoryConfig) as ResumeItem['category'][]).map(cat => (
                    <SelectItem key={cat} value={cat}>{categoryConfig[cat].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input placeholder="e.g., React.js, Software Engineer Intern..." value={formData.title || ''} onChange={(e) => setFormData(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Subtitle</Label>
              <Input placeholder="e.g., Company name, University..." value={formData.subtitle || ''} onChange={(e) => setFormData(p => ({ ...p, subtitle: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea placeholder="Brief description..." value={formData.description || ''} onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input placeholder="e.g., 2024, Jan 2025..." value={formData.date || ''} onChange={(e) => setFormData(p => ({ ...p, date: e.target.value }))} />
              </div>
              {formData.category === 'skills' && (
                <div className="space-y-1.5">
                  <Label>Level</Label>
                  <Select value={formData.level} onValueChange={(v) => setFormData(p => ({ ...p, level: v as ResumeItem['level'] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                      <SelectItem value="expert">Expert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleSave} disabled={!formData.title} className="flex-1">
                {editingItem ? 'Update' : 'Add Item'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────── Main GoalList ───────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export function GoalList() {
  const { goals, tasks } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const filteredGoals = goals.filter((goal) => {
    if (filter === 'all') return true;
    if (filter === 'completed') return goal.status === 'completed' || goal.current_value >= goal.target_value;
    return goal.status === 'active' && goal.current_value < goal.target_value;
  });

  const activeGoals = goals.filter((g) => g.status === 'active' && g.current_value < g.target_value);
  const completedGoals = goals.filter((g) => g.status === 'completed' || g.current_value >= g.target_value);
  const totalProgress = goals.length > 0
    ? Math.round(goals.reduce((acc, g) => acc + getProgressPercentage(g.current_value, g.target_value), 0) / goals.length)
    : 0;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6">
      <Tabs defaultValue="goals" className="w-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display">Goals</h1>
            <p className="text-sm text-muted-foreground">Track your academic and personal goals</p>
          </div>
          <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> Add Goal
          </Button>
        </div>

        {/* Overview stats */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { icon: Target, label: 'Total Goals', value: goals.length, color: 'indigo', grad: 'from-indigo-500/10 to-indigo-500/5' },
            { icon: TrendingUp, label: 'In Progress', value: activeGoals.length, color: 'blue', grad: 'from-blue-500/10 to-blue-500/5' },
            { icon: Trophy, label: 'Completed', value: completedGoals.length, color: 'green', grad: 'from-green-500/10 to-green-500/5' },
            { icon: Star, label: 'Avg Progress', value: `${totalProgress}%`, color: 'amber', grad: 'from-amber-500/10 to-amber-500/5' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className={`bg-gradient-to-br ${s.grad} glow-border`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl bg-${s.color}-500/10`}>
                      <Icon className={`w-5 h-5 text-${s.color}-500`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-display">{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </motion.div>

        <TabsList className="mb-6 bg-muted/50">
          <TabsTrigger value="goals" className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" /> Goals
          </TabsTrigger>
          <TabsTrigger value="autotrack" className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Auto-Track
          </TabsTrigger>
          <TabsTrigger value="resume" className="flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5" /> Resume
          </TabsTrigger>
          <TabsTrigger value="college" className="flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5" /> College Prep
          </TabsTrigger>
        </TabsList>

        <TabsContent value="goals">
          {/* Filter */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1.5 w-fit mb-5">
            {(['all', 'active', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'relative px-4 py-1.5 text-xs font-medium rounded-md transition-all capitalize',
                  filter === f ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {filter === f && (
                  <motion.div layoutId="goalFilterIndicator" className="absolute inset-0 bg-primary rounded-md shadow-sm" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                )}
                <span className="relative z-10">{f}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <AnimatePresence mode="popLayout">
              {filteredGoals.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-2 text-center py-16">
                  <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity }} className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                    <Target className="w-8 h-8 text-muted-foreground" />
                  </motion.div>
                  <p className="font-medium">No goals found</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a new goal to start tracking your progress</p>
                </motion.div>
              ) : (
                filteredGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    linkedTasks={tasks.filter(t => t.status === 'completed').slice(0, 3)}
                    onEdit={(g) => { setEditingGoal(g); setShowForm(true); }}
                  />
                ))
              )}
            </AnimatePresence>
          </div>
        </TabsContent>

        <TabsContent value="autotrack">
          <AutoTrackTab />
        </TabsContent>

        <TabsContent value="resume">
          <ResumeTab />
        </TabsContent>

        <TabsContent value="college">
          <CollegePrepTab />
        </TabsContent>
      </Tabs>

      <GoalForm
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingGoal(null); }}
        goal={editingGoal}
      />
    </motion.div>
  );
}
