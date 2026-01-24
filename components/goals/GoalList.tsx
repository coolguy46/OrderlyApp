'use client';

import { useState, useEffect } from 'react';
import { Goal, GoalType } from '@/lib/supabase/types';
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
import { CircularProgress } from '@/components/ui';
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
} from 'lucide-react';

interface GoalCardProps {
  goal: Goal;
  onEdit: (goal: Goal) => void;
}

function GoalCard({ goal, onEdit }: GoalCardProps) {
  const { updateGoal, deleteGoal } = useAppStore();
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
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className={cn('group hover:shadow-md transition-shadow', isCompleted && 'border-green-500/30')}>
        <CardContent className="p-6">
          <div className="flex items-start gap-5">
            {/* Progress Circle */}
            <CircularProgress
              value={goal.current_value}
              max={goal.target_value}
              size={80}
              strokeWidth={6}
              color={isCompleted ? '#10b981' : '#6366f1'}
            >
              {isCompleted ? (
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              ) : (
                <span className="text-lg font-bold">{progress}%</span>
              )}
            </CircularProgress>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <h3 className={cn(
                    'font-semibold',
                    isCompleted && 'text-green-400'
                  )}>
                    {goal.title}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={cn(
                      goal.goal_type === 'short_term'
                        ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                    )}>
                      {goal.goal_type === 'short_term' ? 'Short Term' : 'Long Term'}
                    </Badge>
                    {daysLeft !== null && daysLeft >= 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {daysLeft === 0 ? 'Today' : `${daysLeft} days left`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(goal)}
                  >
                    <Edit3 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteGoal(goal.id)}
                    className="text-red-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {goal.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {goal.description}
                </p>
              )}

              {/* Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {goal.current_value} / {goal.target_value} {goal.unit}
                  </span>
                  {!isCompleted && (
                    <Button size="sm" variant="ghost" onClick={handleIncrement} className="h-7 gap-1">
                      <Plus className="w-3 h-3" />
                      Add 1
                    </Button>
                  )}
                </div>
                <Progress 
                  value={progress} 
                  className={cn("h-2", isCompleted && "[&>div]:bg-green-500")} 
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

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
      deadline: deadline ? new Date(deadline).toISOString() : null,
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
    setTitle('');
    setDescription('');
    setTargetValue('10');
    setCurrentValue('0');
    setUnit('tasks');
    setGoalType('short_term');
    setDeadline('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit Goal' : 'Create New Goal'}</DialogTitle>
          <DialogDescription>
            {goal ? 'Update your goal details below.' : 'Set a new goal to track your progress.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="title">Goal Title</Label>
            <Input
              id="title"
              placeholder="e.g., Complete 20 assignments"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe your goal..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="target">Target</Label>
              <Input
                id="target"
                type="number"
                min="1"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current">Current</Label>
              <Input
                id="current"
                type="number"
                min="0"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                placeholder="e.g., tasks"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Goal Type</Label>
              <Select value={goalType} onValueChange={(v) => setGoalType(v as GoalType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_term">Short Term</SelectItem>
                  <SelectItem value="long_term">Long Term</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deadline">Deadline</Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              {goal ? 'Update Goal' : 'Create Goal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GoalList() {
  const { goals } = useAppStore();
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

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-indigo-500/10">
                <Target className="w-6 h-6 text-indigo-500" />
              </div>
              <div>
                <p className="text-3xl font-bold">{goals.length}</p>
                <p className="text-sm text-muted-foreground">Total Goals</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-500/10">
                <TrendingUp className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-3xl font-bold">{activeGoals.length}</p>
                <p className="text-sm text-muted-foreground">In Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-green-500/10">
                <Trophy className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-3xl font-bold">{completedGoals.length}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1.5">
          {(['all', 'active', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-4 py-2 text-[clamp(0.65rem,1.5vw,0.75rem)] font-medium rounded-md transition-all capitalize',
                filter === f
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <Button onClick={() => setShowForm(true)} size="lg">
          <Plus className="w-4 h-4" />
          Add Goal
        </Button>
      </div>

      {/* Goals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredGoals.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-2 text-center py-16"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Target className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="font-medium">No goals found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a new goal to start tracking your progress
              </p>
            </motion.div>
          ) : (
            filteredGoals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={(g) => {
                  setEditingGoal(g);
                  setShowForm(true);
                }}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Goal Form Modal */}
      <GoalForm
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingGoal(null);
        }}
        goal={editingGoal}
      />
    </div>
  );
}
