'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { motion, AnimatePresence } from 'framer-motion';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  BookOpen,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type ViewMode = 'month' | 'week' | 'day';

export function Calendar() {
  const { tasks, exams, studySessions, subjects } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    setCurrentDate(new Date());
    setMounted(true);
  }, []);

  const calendarDays = useMemo(() => {
    if (!currentDate) return [];
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
  }, [currentDate]);

  const getEventsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');

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

    return { tasks: dayTasks, exams: dayExams, sessions: daySessions };
  };

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : null;

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (!mounted || !currentDate) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-muted-foreground">Loading calendar...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold">
                {format(currentDate, 'MMMM yyyy')}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'px-4 py-1.5 text-sm font-medium rounded-md transition-all capitalize',
                    viewMode === mode
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-4">
              {/* Week Day Headers */}
              <div className="grid grid-cols-7 gap-1 mb-4">
                {weekDays.map((day) => (
                  <div
                    key={day}
                    className="text-center text-sm font-medium text-muted-foreground py-2"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Days */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, index) => {
                  const events = getEventsForDate(day);
                  const hasEvents =
                    events.tasks.length > 0 ||
                    events.exams.length > 0 ||
                    events.sessions.length > 0;

                  return (
                    <motion.button
                      key={day.toString()}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        'aspect-square p-1 rounded-lg flex flex-col items-center justify-start transition-all',
                        !isSameMonth(day, currentDate) && 'opacity-30',
                        isToday(day) &&
                          'bg-primary/20 border border-primary',
                        selectedDate && isSameDay(day, selectedDate) &&
                          'bg-primary/10 border border-primary/50',
                        !isToday(day) &&
                          !(selectedDate && isSameDay(day, selectedDate)) &&
                          'hover:bg-muted'
                      )}
                    >
                      <span
                        className={cn(
                          'text-sm font-medium',
                          isToday(day) ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {format(day, 'd')}
                      </span>

                      {/* Event Indicators */}
                      {hasEvents && (
                        <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                          {events.tasks.slice(0, 3).map((task, i) => (
                            <div
                              key={i}
                              className={cn(
                                'w-1.5 h-1.5 rounded-full',
                                task.priority === 'high'
                                  ? 'bg-red-500'
                                  : task.priority === 'medium'
                                  ? 'bg-yellow-500'
                                  : 'bg-green-500'
                              )}
                            />
                          ))}
                          {events.exams.map((_, i) => (
                            <div
                              key={`exam-${i}`}
                              className="w-1.5 h-1.5 rounded-full bg-purple-500"
                            />
                          ))}
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  High Priority
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  Medium Priority
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Low Priority
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  Exam
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Selected Date Details */}
        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-primary" />
                {selectedDate
                  ? format(selectedDate, 'MMMM d, yyyy')
                  : 'Select a date'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedDate && selectedDateEvents ? (
                <div className="space-y-4">
                  {/* Tasks */}
                  {selectedDateEvents.tasks.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Tasks ({selectedDateEvents.tasks.length})
                      </h4>
                      <div className="space-y-2">
                        {selectedDateEvents.tasks.map((task) => {
                          const subject = subjects.find((s) => s.id === task.subject_id);
                          return (
                            <div
                              key={task.id}
                              className="p-3 bg-muted/50 rounded-lg border border-border"
                            >
                              <p className="text-sm font-medium">
                                {task.title}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                {subject && (
                                  <Badge variant="secondary" style={{ backgroundColor: subject.color + '20', color: subject.color }}>
                                    {subject.name}
                                  </Badge>
                                )}
                                <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'default' : 'secondary'}>
                                  {task.priority}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Exams */}
                  {selectedDateEvents.exams.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Exams ({selectedDateEvents.exams.length})
                      </h4>
                      <div className="space-y-2">
                        {selectedDateEvents.exams.map((exam) => {
                          const subject = subjects.find((s) => s.id === exam.subject_id);
                          return (
                            <div
                              key={exam.id}
                              className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30"
                            >
                              <p className="text-sm font-medium">
                                {exam.title}
                              </p>
                              {exam.location && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  📍 {exam.location}
                                </p>
                              )}
                              {subject && (
                                <div className="mt-2">
                                  <Badge variant="secondary" style={{ backgroundColor: subject.color + '20', color: subject.color }}>
                                    {subject.name}
                                  </Badge>
                                </div>
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
                      <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                        <BookOpen className="w-4 h-4" />
                        Study Sessions ({selectedDateEvents.sessions.length})
                      </h4>
                      <div className="space-y-2">
                        {selectedDateEvents.sessions.map((session) => {
                          const subject = subjects.find(
                            (s) => s.id === session.subject_id
                          );
                          return (
                            <div
                              key={session.id}
                              className="p-3 bg-muted/50 rounded-lg border border-border"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm">
                                  {session.duration_minutes} minutes
                                </span>
                                <Badge variant="outline" className="capitalize text-xs">
                                  {session.session_type.replace('_', ' ')}
                                </Badge>
                              </div>
                              {subject && (
                                <div className="mt-2">
                                  <Badge variant="secondary" style={{ backgroundColor: subject.color + '20', color: subject.color }}>
                                    {subject.name}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedDateEvents.tasks.length === 0 &&
                    selectedDateEvents.exams.length === 0 &&
                    selectedDateEvents.sessions.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No events for this date
                      </p>
                    )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Click on a date to see details
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
