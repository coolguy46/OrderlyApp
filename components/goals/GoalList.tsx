'use client';

import { useState, useEffect } from 'react';
import { Goal, GoalType, Task } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { 
  Card, 
  CardContent,
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
  Star,
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
    }
    onClose();
  };

  const resetForm = () => {
    setTitle(''); setDescription(''); setTargetValue('10');
    setCurrentValue('0'); setUnit('tasks'); setGoalType('short_term');
    setDeadline('');
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
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1">{goal ? 'Update Goal' : 'Create Goal'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
      <div className="w-full">
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
      </div>

      <GoalForm
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingGoal(null); }}
        goal={editingGoal}
      />
    </motion.div>
  );
}
