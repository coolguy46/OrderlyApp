'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  addDays,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
  getHours,
  setHours,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  BookOpen,
  Target,
  Plus,
  X,
  Repeat,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type ViewMode = 'month' | 'week' | 'day';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  date: string;
  time?: string;
  type: 'event';
  color: string;
  recurrence?: 'none' | 'daily' | 'weekly' | 'weekdays';
}

export function Calendar() {
  const { tasks, exams, studySessions, subjects, addTask, user } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Event/Task creation modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'task' | 'event'>('task');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemTime, setNewItemTime] = useState('09:00');
  const [newItemRecurrence, setNewItemRecurrence] = useState<'none' | 'daily' | 'weekly' | 'weekdays'>('none');
  const [newItemPriority, setNewItemPriority] = useState<'low' | 'medium' | 'high'>('medium');
  
  // Local events storage
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    setCurrentDate(new Date());
    setMounted(true);
    
    // Load events from localStorage
    const savedEvents = localStorage.getItem('calendarEvents');
    if (savedEvents) {
      setLocalEvents(JSON.parse(savedEvents));
    }
  }, []);

  // Save events to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('calendarEvents', JSON.stringify(localEvents));
    }
  }, [localEvents, mounted]);

  // Generate days based on view mode
  const viewDays = useMemo(() => {
    if (!currentDate) return [];
    
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(monthStart);
      const startDate = startOfWeek(monthStart);
      const endDate = endOfWeek(monthEnd);
      const days: Date[] = [];
      let day = startDate;
      while (day <= endDate) {
        days.push(day);
        day = addDays(day, 1);
      }
      return days;
    } else if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        days.push(addDays(weekStart, i));
      }
      return days;
    } else {
      return [startOfDay(currentDate)];
    }
  }, [currentDate, viewMode]);

  // Get events for a specific date (including recurring events)
  const getEventsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayOfWeek = date.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    const dayTasks = tasks.filter((task) => {
      if (!task.due_date) return false;
      return format(parseISO(task.due_date), 'yyyy-MM-dd') === dateStr;
    });

    const dayExams = exams.filter((exam) => {
      return format(parseISO(exam.exam_date), 'yyyy-MM-dd') === dateStr;
    });

    const daySessions = studySessions.filter((session) => {
      return format(parseISO(session.started_at), 'yyyy-MM-dd') === dateStr;
    });

    // Check for recurring events
    const dayEvents = localEvents.filter((event) => {
      const eventDate = parseISO(event.date);
      const eventDateStr = format(eventDate, 'yyyy-MM-dd');
      
      if (eventDateStr === dateStr) return true;
      if (event.recurrence === 'daily' && date >= eventDate) return true;
      if (event.recurrence === 'weekly' && date >= eventDate && date.getDay() === eventDate.getDay()) return true;
      if (event.recurrence === 'weekdays' && date >= eventDate && isWeekday) return true;
      
      return false;
    });

    return { tasks: dayTasks, exams: dayExams, sessions: daySessions, events: dayEvents };
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!currentDate) return;
    
    if (viewMode === 'month') {
      setCurrentDate(direction === 'prev' ? subMonths(currentDate, 1) : addMonths(currentDate, 1));
    } else if (viewMode === 'week') {
      setCurrentDate(direction === 'prev' ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1));
    } else {
      setCurrentDate(direction === 'prev' ? addDays(currentDate, -1) : addDays(currentDate, 1));
    }
  };

  const handleAddItem = async () => {
    if (!selectedDate || !newItemTitle.trim()) return;

    if (addType === 'task') {
      await addTask({
        user_id: user?.id || '',
        title: newItemTitle,
        description: newItemDescription || null,
        priority: newItemPriority,
        status: 'pending',
        subject_id: null,
        due_date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          parseInt(newItemTime.split(':')[0]),
          parseInt(newItemTime.split(':')[1])
        ).toISOString(),
        completed_at: null,
      });
    } else {
      const newEvent: CalendarEvent = {
        id: crypto.randomUUID(),
        title: newItemTitle,
        description: newItemDescription,
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: newItemTime,
        type: 'event',
        color: '#6366f1',
        recurrence: newItemRecurrence,
      };
      setLocalEvents([...localEvents, newEvent]);
    }

    setShowAddModal(false);
    resetAddForm();
  };

  const handleDeleteEvent = (eventId: string) => {
    setLocalEvents(localEvents.filter(e => e.id !== eventId));
  };

  const resetAddForm = () => {
    setNewItemTitle('');
    setNewItemDescription('');
    setNewItemTime('09:00');
    setNewItemRecurrence('none');
    setNewItemPriority('medium');
    setAddType('task');
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
  };

  const openAddModal = () => {
    if (!selectedDate) {
      setSelectedDate(new Date());
    }
    setShowAddModal(true);
  };

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : null;
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  if (!mounted || !currentDate) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-muted-foreground">Loading calendar...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">
                {viewMode === 'day' 
                  ? format(currentDate, 'EEEE, MMMM d, yyyy')
                  : viewMode === 'week'
                  ? `Week of ${format(startOfWeek(currentDate), 'MMM d, yyyy')}`
                  : format(currentDate, 'MMMM yyyy')
                }
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleNavigate('prev')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setCurrentDate(new Date())}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleNavigate('next')}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded-md transition-all capitalize',
                      viewMode === mode
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              
              <Button size="sm" onClick={openAddModal} className="h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Calendar Grid */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-3">
              {viewMode === 'month' && (
                <>
                  {/* Week Day Headers */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {weekDays.map((day) => (
                      <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar Days */}
                  <div className="grid grid-cols-7 gap-1">
                    {viewDays.map((day, index) => {
                      const events = getEventsForDate(day);
                      const hasEvents = events.tasks.length > 0 || events.exams.length > 0 || events.events.length > 0;

                      return (
                        <motion.button
                          key={day.toString()}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleDateClick(day)}
                          className={cn(
                            'aspect-square p-1 rounded-lg flex flex-col items-center justify-start transition-all min-h-[60px]',
                            !isSameMonth(day, currentDate) && 'opacity-30',
                            isToday(day) && 'bg-primary/20 border border-primary',
                            selectedDate && isSameDay(day, selectedDate) && 'bg-primary/10 border border-primary/50',
                            !isToday(day) && !(selectedDate && isSameDay(day, selectedDate)) && 'hover:bg-muted'
                          )}
                        >
                          <span className={cn(
                            'text-xs font-medium',
                            isToday(day) ? 'text-primary' : 'text-foreground'
                          )}>
                            {format(day, 'd')}
                          </span>

                          {hasEvents && (
                            <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                              {events.tasks.slice(0, 2).map((task, i) => (
                                <div key={i} className={cn(
                                  'w-1 h-1 rounded-full',
                                  task.priority === 'high' ? 'bg-red-500' : task.priority === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                                )} />
                              ))}
                              {events.exams.slice(0, 1).map((_, i) => (
                                <div key={`exam-${i}`} className="w-1 h-1 rounded-full bg-purple-500" />
                              ))}
                              {events.events.slice(0, 1).map((_, i) => (
                                <div key={`event-${i}`} className="w-1 h-1 rounded-full bg-blue-500" />
                              ))}
                            </div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </>
              )}

              {viewMode === 'week' && (
                <div className="space-y-2">
                  {/* Week Header */}
                  <div className="grid grid-cols-7 gap-1">
                    {viewDays.map((day) => (
                      <button
                        key={day.toString()}
                        onClick={() => handleDateClick(day)}
                        className={cn(
                          'p-2 rounded-lg text-center transition-all',
                          isToday(day) && 'bg-primary/20 border border-primary',
                          selectedDate && isSameDay(day, selectedDate) && 'bg-primary/10',
                          'hover:bg-muted'
                        )}
                      >
                        <div className="text-xs text-muted-foreground">{format(day, 'EEE')}</div>
                        <div className={cn('text-lg font-bold', isToday(day) && 'text-primary')}>{format(day, 'd')}</div>
                      </button>
                    ))}
                  </div>

                  {/* Week Events */}
                  <div className="grid grid-cols-7 gap-1 min-h-[200px]">
                    {viewDays.map((day) => {
                      const events = getEventsForDate(day);
                      return (
                        <div key={day.toString()} className="space-y-1 p-1">
                          {events.tasks.slice(0, 3).map((task) => (
                            <div key={task.id} className="text-xs p-1 rounded bg-primary/10 truncate">
                              {task.title}
                            </div>
                          ))}
                          {events.events.slice(0, 2).map((event) => (
                            <div key={event.id} className="text-xs p-1 rounded bg-blue-500/10 truncate flex items-center gap-1">
                              {event.recurrence !== 'none' && <Repeat className="w-2 h-2" />}
                              {event.title}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {viewMode === 'day' && (
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {hours.map((hour) => {
                    const hourEvents = selectedDateEvents?.events.filter(e => 
                      e.time && parseInt(e.time.split(':')[0]) === hour
                    ) || [];
                    const hourTasks = selectedDateEvents?.tasks.filter(t => 
                      t.due_date && getHours(parseISO(t.due_date)) === hour
                    ) || [];

                    return (
                      <div key={hour} className="flex border-t border-border/50">
                        <div className="w-12 text-xs text-muted-foreground py-1 shrink-0">
                          {format(setHours(new Date(), hour), 'ha')}
                        </div>
                        <div className="flex-1 min-h-[30px] py-1 space-y-0.5">
                          {hourTasks.map((task) => (
                            <div key={task.id} className="text-xs p-1 rounded bg-primary/10">
                              {task.title}
                            </div>
                          ))}
                          {hourEvents.map((event) => (
                            <div key={event.id} className="text-xs p-1 rounded bg-blue-500/10 flex items-center gap-1">
                              {event.recurrence !== 'none' && <Repeat className="w-2 h-2" />}
                              {event.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-red-500" /> High
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" /> Medium
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-green-500" /> Low
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-purple-500" /> Exam
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-blue-500" /> Event
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Selected Date Details */}
        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-primary" />
                {selectedDate ? format(selectedDate, 'MMM d, yyyy') : 'Select a date'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {selectedDate && selectedDateEvents ? (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {/* Tasks */}
                  {selectedDateEvents.tasks.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Tasks ({selectedDateEvents.tasks.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedDateEvents.tasks.map((task) => {
                          const subject = subjects.find((s) => s.id === task.subject_id);
                          return (
                            <div key={task.id} className="p-2 bg-muted/50 rounded-lg border border-border text-xs">
                              <p className="font-medium">{task.title}</p>
                              <div className="flex items-center gap-1 mt-1">
                                {subject && (
                                  <Badge variant="secondary" className="text-[10px] h-4" style={{ backgroundColor: subject.color + '20', color: subject.color }}>
                                    {subject.name}
                                  </Badge>
                                )}
                                <Badge variant={task.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px] h-4">
                                  {task.priority}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Events */}
                  {selectedDateEvents.events.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <CalendarIcon className="w-3 h-3" /> Events ({selectedDateEvents.events.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedDateEvents.events.map((event) => (
                          <div key={event.id} className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-xs">
                            <div className="flex items-center justify-between">
                              <p className="font-medium flex items-center gap-1">
                                {event.recurrence !== 'none' && <Repeat className="w-3 h-3" />}
                                {event.title}
                              </p>
                              <button onClick={() => handleDeleteEvent(event.id)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            {event.time && <p className="text-muted-foreground">{event.time}</p>}
                            {event.recurrence !== 'none' && (
                              <Badge variant="outline" className="text-[10px] h-4 mt-1">
                                {event.recurrence}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Exams */}
                  {selectedDateEvents.exams.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Target className="w-3 h-3" /> Exams ({selectedDateEvents.exams.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedDateEvents.exams.map((exam) => {
                          const subject = subjects.find((s) => s.id === exam.subject_id);
                          return (
                            <div key={exam.id} className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20 text-xs">
                              <p className="font-medium">{exam.title}</p>
                              {exam.location && <p className="text-muted-foreground">📍 {exam.location}</p>}
                              {subject && (
                                <Badge variant="secondary" className="text-[10px] h-4 mt-1" style={{ backgroundColor: subject.color + '20', color: subject.color }}>
                                  {subject.name}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Study Sessions */}
                  {selectedDateEvents.sessions.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> Sessions ({selectedDateEvents.sessions.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedDateEvents.sessions.map((session) => (
                          <div key={session.id} className="p-2 bg-muted/50 rounded-lg border border-border text-xs">
                            <div className="flex items-center justify-between">
                              <span>{session.duration_minutes} min</span>
                              <Badge variant="outline" className="text-[10px] h-4 capitalize">
                                {session.session_type.replace('_', ' ')}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedDateEvents.tasks.length === 0 && selectedDateEvents.exams.length === 0 && 
                   selectedDateEvents.sessions.length === 0 && selectedDateEvents.events.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No events for this date</p>
                  )}

                  <Button size="sm" variant="outline" onClick={openAddModal} className="w-full h-7 text-xs mt-2">
                    <Plus className="w-3 h-3 mr-1" /> Add to this date
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">Click on a date to see details</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Task/Event Modal */}
      <Dialog open={showAddModal} onOpenChange={(open) => !open && setShowAddModal(false)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-lg">Add to {selectedDate ? format(selectedDate, 'MMM d, yyyy') : 'Calendar'}</DialogTitle>
            <DialogDescription className="text-sm">Create a new task or event</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 mt-2">
            {/* Type Toggle */}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
              <button
                onClick={() => setAddType('task')}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  addType === 'task' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Task
              </button>
              <button
                onClick={() => setAddType('event')}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  addType === 'event' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Event
              </button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Title</Label>
              <Input
                placeholder={`Enter ${addType} title...`}
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
                className="h-8"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Description (optional)</Label>
              <Textarea
                placeholder="Enter description..."
                value={newItemDescription}
                onChange={(e) => setNewItemDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Time</Label>
                <Input
                  type="time"
                  value={newItemTime}
                  onChange={(e) => setNewItemTime(e.target.value)}
                  className="h-8"
                />
              </div>

              {addType === 'task' ? (
                <div className="space-y-1.5">
                  <Label className="text-sm">Priority</Label>
                  <Select value={newItemPriority} onValueChange={(v) => setNewItemPriority(v as 'low' | 'medium' | 'high')}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">🟢 Low</SelectItem>
                      <SelectItem value="medium">🟡 Medium</SelectItem>
                      <SelectItem value="high">🔴 High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-sm">Repeat</Label>
                  <Select value={newItemRecurrence} onValueChange={(v) => setNewItemRecurrence(v as 'none' | 'daily' | 'weekly' | 'weekdays')}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No repeat</SelectItem>
                      <SelectItem value="daily">Every day</SelectItem>
                      <SelectItem value="weekly">Every week</SelectItem>
                      <SelectItem value="weekdays">Weekdays only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddModal(false)} className="flex-1 h-8">
                Cancel
              </Button>
              <Button onClick={handleAddItem} disabled={!newItemTitle.trim()} className="flex-1 h-8">
                Add {addType}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
