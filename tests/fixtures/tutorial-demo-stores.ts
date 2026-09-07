/* eslint-disable @typescript-eslint/no-explicit-any -- Deliberately isolated screenshot-only store boundary. */
import { create } from 'zustand';
import { getDefaultPlannerSettings } from '../../lib/planner/types';
import { localDateTimeToIso } from '../../lib/schedule/selectors';

export const demoOwner = 'tutorial-demo-alex';
export const demoNow = '2026-09-07T21:00:00Z';
const zone = 'America/Los_Angeles';
const noop = () => {};
const success = async () => true;
export const demoTasks = [
  { id: 'biology', title: 'Biology Worksheet', subject_id: 'biology', priority: 'medium', status: 'pending', due_date: '2026-09-08T04:00:00Z', due_time: '21:00', description: 'Review cell structures and complete questions 1–8.', source: 'canvas', course_name: 'Biology' },
  { id: 'essay', title: 'English Essay Draft', subject_id: 'english', priority: 'high', status: 'pending', due_date: '2026-09-07T04:00:00Z', due_time: '21:00', description: 'Write an introduction and two supporting paragraphs.', source: 'manual', course_name: 'English' },
  { id: 'math', title: 'Math Practice', subject_id: 'math', priority: 'low', status: 'completed', due_date: '2026-09-08T04:00:00Z', due_time: '21:00', description: 'Practice linear equations, questions 1–10.', source: 'manual', completed_at: '2026-09-07T19:00:00Z', course_name: 'Math' },
].map(t => ({ user_id: demoOwner, created_at: '2026-09-01T19:00:00Z', updated_at: demoNow, recurrence: 'none', recurrence_days: null, completed_at: null, assignment_type: 'assignment', ...t }));
export const demoEvents = [
  { id: 'soccer', title: 'Soccer Practice', description: 'Bring water and soccer shoes.', location: 'School field', kind: 'sports', daysOfWeek: [1,3], startTime: '16:30', endTime: '17:30', startDate: '2026-09-07', endDate: '2026-10-02', color: '#6366f1' },
  { id: 'counselor', title: 'Counselor Meeting', description: 'Discuss the essay outline and next steps.', location: 'Counseling office', kind: 'appointment', daysOfWeek: [2], startTime: '16:00', endTime: '16:30', startDate: '2026-09-08', endDate: '2026-09-08', color: '#06b6d4' },
].map(e => ({ timeZone: zone, enabled: true, occurrenceOverrides: {}, ...e }));
export const demoEntries = Object.fromEntries([
  ['biology', '2026-09-07', '18:00', 1800],
  ['essay', '2026-09-07', '19:00', 3600],
  ['math', '2026-09-07', '11:30', 1800],
].map(([taskId, date, time, duration]) => [taskId, { id: `schedule-${taskId}`, userId: demoOwner, taskId, scheduledDate: date, startAt: localDateTimeToIso(String(date), String(time), zone), durationSeconds: duration, recurrence: 'none', recurrenceDays: null, recurrenceEndDate: null, occurrenceOverrides: {}, createdAt: demoNow, updatedAt: demoNow }]));

export const useAppStore = create<any>(() => ({
  dataLoaded: true, user: { id: demoOwner, email: 'alex@example.invalid', full_name: 'Alex Morgan', avatar_url: null, total_study_time: 25, tasks_completed: 1, created_at: '2026-09-01T19:00:00Z' },
  tasks: demoTasks,
  subjects: [{ id: 'biology', name: 'Biology', color: '#10b981' }, { id: 'english', name: 'English', color: '#8b5cf6' }, { id: 'math', name: 'Math', color: '#3b82f6' }].map(s => ({ ...s, user_id: demoOwner })),
  goals: [{ id: 'outline', user_id: demoOwner, title: 'Finish the Essay Outline', description: 'Choose a thesis and outline three supporting points.', target_value: 4, current_value: 1, unit: 'steps', goal_type: 'short_term', deadline: '2026-09-09T19:00:00Z', status: 'active', created_at: demoNow }],
  exams: [{ id: 'quiz', user_id: demoOwner, subject_id: 'biology', title: 'Biology Quiz', description: 'Cell structures and their functions.', exam_date: '2026-09-11T16:00:00Z', exam_time: '09:00', location: 'Room 204', preparation_progress: 25, source: 'manual', created_at: demoNow }],
  studySessions: [{ id: 'study', user_id: demoOwner, subject_id: 'math', task_id: 'math', duration_minutes: 25, session_type: 'pomodoro', started_at: '2026-09-07T18:30:00Z', ended_at: '2026-09-07T18:55:00Z' }],
  pomodoroSettings: { focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, sessionsBeforeLongBreak: 4 }, activeStudySeconds: 0, theme: 'dark', sidebarOpen: true,
  finalizeTaskCreations: noop, addTask: async () => null, updateTask: success, completeTask: success, deleteTask: success, refreshData: async () => {}, addSubject: async () => null, deleteSubject: success, updateGoal: success, deleteGoal: success, updateExam: success, deleteExam: success, addStudySession: success, setActiveStudy: noop, clearActiveStudy: noop, setTheme: noop, updateUserProfile: success, logout: success, toggleSidebar: noop,
}));
export const usePlannerStore = create<any>(() => ({
  users: { [demoOwner]: { settings: { ...getDefaultPlannerSettings(zone), schoolHomeTime: '15:30' }, commitments: demoEvents, estimateCache: {}, feedbackMultipliers: {}, latestPlan: null, plans: [], notifications: [] } },
  setActiveUser: noop, upsertCommitment: noop, removeCommitment: noop, waitForPlannerPersistence: success, updateSettings: noop, clearUserPlannerData: noop,
}));
export const useScheduleStore = create<any>(() => ({
  entriesByUser: { [demoOwner]: demoEntries }, upsertTaskSchedule: noop, setOccurrenceOverride: noop, clearOccurrenceOverride: noop, removeTaskSchedule: noop, waitForSchedulePersistence: success, moveOccurrence: noop, resizeOccurrence: noop, clearTaskSchedules: noop,
}));

sessionStorage.setItem(`orderly:assistant-chat:v2:${demoOwner}`, JSON.stringify([
  { id: 'question', role: 'user', content: 'What should I work on today? Keep soccer practice free.' },
  { id: 'answer', role: 'assistant', content: 'Your calendar has:\n\n- **4:30–5:30 PM:** Soccer Practice.\n- **6–6:30 PM:** Biology Worksheet.\n- **7–8 PM:** English Essay Draft (overdue).\n\nMath Practice is done. Your deadlines stay unchanged.' },
]));
