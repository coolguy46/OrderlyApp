'use client';

import { useState, useEffect } from 'react';
import { Task, TaskPriority, TaskStatus } from '@/lib/supabase/types';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, X, Plus, AlertCircle, Sparkles, Calendar, Tag, Flag, BookOpen, FileText, Zap } from 'lucide-react';
import { calculateSuggestedPriority } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface TaskFormProps {
  isOpen: boolean;
  onClose: () => void;
  task?: Task | null;
}

const SUBJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];

export function TaskForm({ isOpen, onClose, task }: TaskFormProps) {
  const { addTask, updateTask, subjects, addSubject, user } = useAppStore();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [manualPriority, setManualPriority] = useState(false);
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [subjectId, setSubjectId] = useState('none');
  const [dueDate, setDueDate] = useState('');
  
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);

  useEffect(() => {
    if (!manualPriority && dueDate && !task) {
      const suggestedPriority = calculateSuggestedPriority(dueDate);
      setPriority(suggestedPriority);
    }
  }, [dueDate, manualPriority, task]);

  const handlePriorityChange = (value: string) => {
    setPriority(value as TaskPriority);
    setManualPriority(true);
  };

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setSubjectId(task.subject_id || 'none');
      setDueDate(task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : '');
    } else {
      resetForm();
    }
  }, [task, isOpen]);

  const handleCreateSubject = async () => {
    if (!newSubjectName.trim()) return;
    try {
      await addSubject({
        user_id: user?.id || '',
        name: newSubjectName.trim(),
        color: newSubjectColor,
      });
      setNewSubjectName('');
      setShowNewSubject(false);
    } catch (error) {
      console.error('Failed to create subject:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const taskData = {
      user_id: user?.id || '',
      title,
      description: description || null,
      priority,
      status,
      subject_id: subjectId === 'none' ? null : subjectId,
      due_date: dueDate ? new Date(dueDate + 'T00:00:00').toISOString() : null,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    };

    if (task) {
      await updateTask(task.id, taskData);
    } else {
      await addTask(taskData);
    }

    onClose();
    resetForm();
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setManualPriority(false);
    setStatus('pending');
    setSubjectId('none');
    setDueDate('');
    setShowNewSubject(false);
    setNewSubjectName('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-indigo-500/5 to-transparent">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-xl',
                task ? 'bg-amber-500/15' : 'bg-indigo-500/15'
              )}>
                {task ? (
                  <FileText className="w-5 h-5 text-amber-400" />
                ) : (
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                )}
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">
                  {task ? 'Edit Task' : 'New Task'}
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {task ? 'Update the details below' : 'Fill in the details to create a task'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        
        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              Title
            </Label>
            <Input
              id="title"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="h-10 bg-muted/30 border-border/50 focus:bg-background"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" />
              Description
              <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">(optional)</span>
            </Label>
            <Textarea
              id="description"
              placeholder="Add more details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none bg-muted/30 border-border/50 focus:bg-background"
            />
          </div>

          {/* Priority & Status row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Flag className="w-3 h-3" />
                Priority
                {!manualPriority && dueDate && (
                  <span className="text-[10px] text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full normal-case tracking-normal font-medium flex items-center gap-0.5">
                    <Zap className="w-2.5 h-2.5" />
                    auto
                  </span>
                )}
              </Label>
              <Select value={priority} onValueChange={handlePriorityChange}>
                <SelectTrigger className="h-9 bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      High
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Low
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger className="h-9 bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Subject & Due Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                Subject
              </Label>
              <AnimatePresence mode="wait">
                {showNewSubject ? (
                  <motion.div
                    key="new-subject"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-2 overflow-hidden"
                  >
                    <Input
                      placeholder="Subject name..."
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      className="h-9 bg-muted/30 border-border/50"
                    />
                    <div className="flex items-center gap-1">
                      {SUBJECT_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewSubjectColor(color)}
                          className={cn(
                            'w-5 h-5 rounded-full transition-all',
                            newSubjectColor === color ? 'scale-125 ring-2 ring-offset-1 ring-offset-background ring-white/50' : 'hover:scale-110'
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowNewSubject(false)}
                        className="flex-1 h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateSubject}
                        disabled={!newSubjectName.trim()}
                        className="flex-1 h-7 text-xs"
                      >
                        Create
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="subject-select"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-1.5"
                  >
                    <Select value={subjectId} onValueChange={setSubjectId}>
                      <SelectTrigger className="h-9 bg-muted/30 border-border/50">
                        <SelectValue placeholder="No Subject" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Subject</SelectItem>
                        {subjects.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-2.5 h-2.5 rounded-full" 
                                style={{ backgroundColor: s.color }}
                              />
                              {s.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNewSubject(true)}
                      className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      New Subject
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dueDate" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Due Date
              </Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 bg-muted/30 border-border/50"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-3 border-t border-border/30">
            <Button
              type="button"
              variant="outline"
              onClick={() => { onClose(); resetForm(); }}
              className="flex-1 h-10"
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1 h-10 gap-1.5 shadow-md shadow-primary/20">
              {task ? (
                <>
                  <Save className="w-4 h-4" />
                  Update Task
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Create Task
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
