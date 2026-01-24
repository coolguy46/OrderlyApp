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
import { Save, X, Plus } from 'lucide-react';

interface TaskFormProps {
  isOpen: boolean;
  onClose: () => void;
  task?: Task | null;
}

// Predefined colors for subjects
const SUBJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];

export function TaskForm({ isOpen, onClose, task }: TaskFormProps) {
  const { addTask, updateTask, subjects, addSubject, user } = useAppStore();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [subjectId, setSubjectId] = useState('none');
  const [dueDate, setDueDate] = useState('');
  
  // New subject creation
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);

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
      
      // Subject is added to store, we'll select it after refresh
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
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
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
    setStatus('pending');
    setSubjectId('none');
    setDueDate('');
    setShowNewSubject(false);
    setNewSubjectName('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-lg">{task ? 'Edit Task' : 'Create New Task'}</DialogTitle>
          <DialogDescription className="text-sm">
            {task ? 'Update the task details below.' : 'Fill in the details to create a new task.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-3 mt-3">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-sm">Title</Label>
            <Input
              id="title"
              placeholder="Enter task title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-sm">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter task description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">🔴 High</SelectItem>
                  <SelectItem value="medium">🟡 Medium</SelectItem>
                  <SelectItem value="low">🟢 Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger className="h-9">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Subject</Label>
              {showNewSubject ? (
                <div className="space-y-2">
                  <Input
                    placeholder="Subject name..."
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    className="h-9"
                  />
                  <div className="flex items-center gap-1">
                    {SUBJECT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewSubjectColor(color)}
                        className={`w-5 h-5 rounded-full transition-transform ${
                          newSubjectColor === color ? 'scale-125 ring-2 ring-offset-1 ring-offset-background ring-white/50' : ''
                        }`}
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
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Select value={subjectId} onValueChange={setSubjectId}>
                    <SelectTrigger className="h-9">
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
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dueDate" className="text-sm">Due Date</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onClose();
                resetForm();
              }}
              className="flex-1 h-9"
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </Button>
            <Button type="submit" className="flex-1 h-9">
              <Save className="w-4 h-4 mr-1" />
              {task ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
