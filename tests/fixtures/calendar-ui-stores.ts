/* eslint-disable @typescript-eslint/no-explicit-any -- Fixture stores implement just the exercised boundary. */
// Controlled browser fixture. These stores replace only the network/storage
// boundary; tests render the real calendar, grid, and TaskForm components.
import { create } from 'zustand';
import { getDefaultPlannerSettings } from '../../lib/planner/types';
import { localDateTimeToIso } from '../../lib/schedule/selectors';

const id = 'calendar-ui-owner';
const now = '2026-09-06T20:00:00Z';
const stored = JSON.parse(localStorage.getItem('calendar-ui-fixture') || 'null');
const initialEvent = { id: 'practice', title: 'Weekend practice', description: 'Bring water', location: 'Park', kind: 'sports',
  daysOfWeek: [6], startTime: '09:00', endTime: '10:00', startDate: '2026-09-05', endDate: '2026-10-31',
  timeZone: 'America/Los_Angeles', color: '#6366f1', enabled: true, occurrenceOverrides: {} };
const settings = { ...getDefaultPlannerSettings('America/Los_Angeles'), schoolDays: [1,2,3,4,5] };
const userRecord = { settings, commitments: stored?.events || [initialEvent], estimateCache: {}, feedbackMultipliers: {}, latestPlan: null, plans: [], notifications: [] };
const persist = () => localStorage.setItem('calendar-ui-fixture', JSON.stringify({ events: usePlannerStore.getState().users[id].commitments,
  tasks: useAppStore.getState().tasks, entries: useScheduleStore.getState().entriesByUser[id] }));
export const useAppStore = create<any>((set) => ({
  user: { id, email: 'calendar-test@example.invalid' }, tasks: stored?.tasks || [], subjects: [], exams: [], goals: [], studySessions: [],
  addTask: async (input: any) => {
    const task = { id: crypto.randomUUID(), created_at: now, updated_at: now, due_date: null, due_time: null, source: 'manual', status: 'pending', ...input };
    set((state: any) => ({ tasks: [...state.tasks, task] })); persist(); return task;
  },
  updateTask: async (taskId: string, patch: any) => { set((s: any) => ({ tasks: s.tasks.map((t: any) => t.id === taskId ? { ...t, ...patch } : t) })); persist(); return true; },
  deleteTask: async (taskId: string) => { set((s: any) => ({ tasks: s.tasks.filter((t: any) => t.id !== taskId) })); persist(); return true; },
  completeTask: async () => true, refreshData: async () => {}, addSubject: async () => null, deleteSubject: async () => {},
}));
export const usePlannerStore = create<any>((set) => ({
  users: { [id]: userRecord }, setActiveUser: () => {},
  upsertCommitment: (_userId: string, event: any) => { set((s: any) => ({ users: { [id]: { ...s.users[id], commitments: [...s.users[id].commitments.filter((e: any) => e.id !== event.id), event] } } })); persist(); },
  removeCommitment: (_userId: string, eventId: string) => { set((s: any) => ({ users: { [id]: { ...s.users[id], commitments: s.users[id].commitments.filter((e: any) => e.id !== eventId) } } })); persist(); },
  waitForPlannerPersistence: async () => true,
}));
export const useScheduleStore = create<any>((set, get) => ({
  entriesByUser: { [id]: stored?.entries || {} },
  upsertTaskSchedule: (_userId: string, taskId: string, patch: any) => {
    set((s: any) => ({ entriesByUser: { [id]: { ...s.entriesByUser[id], [taskId]: { id: `entry-${taskId}`, userId: id, taskId, createdAt: now, updatedAt: now,
      recurrence: 'none', recurrenceDays: null, recurrenceEndDate: null, occurrenceOverrides: {}, ...s.entriesByUser[id][taskId], ...patch } } } })); persist();
  },
  setOccurrenceOverride: (_userId: string, taskId: string, source: string, override: any) => {
    const entry = get().entriesByUser[id][taskId];
    get().upsertTaskSchedule(id, taskId, { occurrenceOverrides: { ...entry.occurrenceOverrides, [source]: { ...entry.occurrenceOverrides[source], ...override } } });
  },
  clearOccurrenceOverride: () => {}, removeTaskSchedule: () => {}, waitForSchedulePersistence: async () => true,
  moveOccurrence: (_userId: string, taskId: string, source: string, date: string, startAt: string) => get().setOccurrenceOverride(id, taskId, source, { scheduledDate: date, startAt }),
  resizeOccurrence: (_userId: string, taskId: string, source: string, durationSeconds: number) => get().setOccurrenceOverride(id, taskId, source, { durationSeconds }),
}));

Object.assign(window, { calendarFixture: {
  state: () => ({ events: usePlannerStore.getState().users[id].commitments, tasks: useAppStore.getState().tasks, entries: useScheduleStore.getState().entriesByUser[id] }),
  addTask: async () => {
    const task = await useAppStore.getState().addTask({ title: 'Repeating study', recurrence: 'weekly', recurrence_days: [2,4], priority: 'medium' });
    useScheduleStore.getState().upsertTaskSchedule(id, task.id, { scheduledDate: '2026-09-08', startAt: localDateTimeToIso('2026-09-08','18:00','America/Los_Angeles'), durationSeconds: 1800,
      recurrence: 'weekly', recurrenceDays: [2,4], recurrenceEndDate: '2026-10-31' });
  },
} });
