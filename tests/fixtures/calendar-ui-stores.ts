/* eslint-disable @typescript-eslint/no-explicit-any -- Fixture stores implement just the exercised boundary. */
// Controlled browser fixture. These stores replace only the network/storage
// boundary; tests render the real calendar, grid, and TaskForm components.
import { create } from 'zustand';
import { getDefaultPlannerSettings } from '../../lib/planner/types';
import { localDateTimeToIso } from '../../lib/schedule/selectors';

const id = 'calendar-ui-owner';
let schedulePersistenceResult = true;
let plannerPersistenceResult = true;
const now = '2026-09-06T20:00:00Z';
const stored = JSON.parse(localStorage.getItem('calendar-ui-fixture') || 'null');
const initialEvent = { id: 'practice', title: 'Weekend practice', description: 'Bring water', location: 'Park', kind: 'sports',
  daysOfWeek: [6], startTime: '09:00', endTime: '10:00', startDate: '2026-09-05', endDate: '2026-10-31',
  timeZone: 'America/Los_Angeles', color: '#6366f1', enabled: true, occurrenceOverrides: {} };
const settings = { ...getDefaultPlannerSettings('America/Los_Angeles'), schoolDays: [1,2,3,4,5] };
const userRecord = { settings, commitments: stored?.events || [initialEvent], estimateCache: {}, feedbackMultipliers: {}, latestPlan: null, plans: [], notifications: [] };
const persist = () => {
  if (!schedulePersistenceResult || !plannerPersistenceResult) return;
  localStorage.setItem('calendar-ui-fixture', JSON.stringify({ events: usePlannerStore.getState().users[id].commitments,
    tasks: useAppStore.getState().tasks, entries: useScheduleStore.getState().entriesByUser[id] }));
};
export const useAppStore = create<any>((set) => ({
  dataLoaded: true, finalizeTaskCreations: () => {},
  user: { id, email: 'calendar-test@example.invalid' }, tasks: stored?.tasks || [], subjects: [], exams: [], goals: [], studySessions: [],
  addTask: async (input: any) => {
    const task = { id: crypto.randomUUID(), user_id: id, created_at: now, updated_at: now, due_date: null, due_time: null, source: 'manual', status: 'pending', ...input };
    set((state: any) => ({ tasks: [...state.tasks, task] })); persist(); return task;
  },
  updateTask: async (taskId: string, patch: any) => { set((s: any) => ({ tasks: s.tasks.map((t: any) => t.id === taskId ? { ...t, ...patch } : t) })); persist(); return true; },
  deleteTask: async (taskId: string) => { set((s: any) => ({ tasks: s.tasks.filter((t: any) => t.id !== taskId) })); persist(); return true; },
  completeTask: async (taskId: string) => { set((s: any) => ({ tasks: s.tasks.map((t: any) => t.id === taskId ? { ...t, status: 'completed', completed_at: now } : t) })); persist(); return true; },
  refreshData: async () => {}, addSubject: async () => null, deleteSubject: async () => {},
}));
export const usePlannerStore = create<any>((set) => ({
  users: { [id]: userRecord }, setActiveUser: () => {},
  upsertCommitment: (_userId: string, event: any) => { set((s: any) => ({ users: { [id]: { ...s.users[id], commitments: [...s.users[id].commitments.filter((e: any) => e.id !== event.id), event] } } })); persist(); },
  removeCommitment: (_userId: string, eventId: string) => { set((s: any) => ({ users: { [id]: { ...s.users[id], commitments: s.users[id].commitments.filter((e: any) => e.id !== eventId) } } })); persist(); },
  waitForPlannerPersistence: async () => plannerPersistenceResult,
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
  clearOccurrenceOverride: () => {}, removeTaskSchedule: () => {}, waitForSchedulePersistence: async () => schedulePersistenceResult,
  moveOccurrence: (_userId: string, taskId: string, source: string, date: string, startAt: string) => get().setOccurrenceOverride(id, taskId, source, { scheduledDate: date, startAt }),
  resizeOccurrence: (_userId: string, taskId: string, source: string, durationSeconds: number) => get().setOccurrenceOverride(id, taskId, source, { durationSeconds }),
}));

Object.assign(window, { calendarFixture: {
  state: () => ({ events: usePlannerStore.getState().users[id].commitments, tasks: useAppStore.getState().tasks, entries: useScheduleStore.getState().entriesByUser[id] }),
  setPersistenceResult: (kind: 'task' | 'event', value: boolean) => { if (kind === 'task') schedulePersistenceResult = value; else plannerPersistenceResult = value; },
  addPersistenceTask: async () => {
    const task = await useAppStore.getState().addTask({ title: 'Save confirmation task', recurrence: 'none', priority: 'medium' });
    useScheduleStore.getState().upsertTaskSchedule(id, task.id, { scheduledDate: '2026-09-06', startAt: localDateTimeToIso('2026-09-06', '18:00', 'America/Los_Angeles'), durationSeconds: 1800 });
  },
  addOvernightItems: async () => {
    usePlannerStore.getState().upsertCommitment(id, { ...initialEvent, id: 'night-event', title: 'Overnight event', daysOfWeek: [0], startDate: '2026-09-06', endDate: '2026-09-06', startTime: '23:00', endTime: '01:00' });
    const task = await useAppStore.getState().addTask({ title: 'Overnight task', recurrence: 'none', priority: 'medium' });
    useScheduleStore.getState().upsertTaskSchedule(id, task.id, { scheduledDate: '2026-09-06', startAt: localDateTimeToIso('2026-09-06', '23:30', 'America/Los_Angeles'), durationSeconds: 7200 });
  },
  saveChatEvent: () => usePlannerStore.getState().upsertCommitment(id, { ...initialEvent, id: 'chat-event', title: 'Future chat event', daysOfWeek: [5], startDate: '2027-03-12', endDate: '2027-03-12' }),
  addLayoutTask: async () => {
    const task = await useAppStore.getState().addTask({
    id: 'layout-canvas-task', title: '[Canvas] Reading and reflection: compare the arguments and prepare your response for class',
    source: 'canvas', priority: 'high', recurrence: 'none', due_date: '2026-09-06T15:00:00Z', due_time: '08:00',
    course_name: 'English Language and Composition', assignment_type: 'Assignment',
    description: '<p>Read both passages and prepare a thoughtful response.</p>'.repeat(18)
      + '<p>Reference: https://example.invalid/' + 'long-resource-name-'.repeat(20) + '</p>',
    });
    useScheduleStore.getState().upsertTaskSchedule(id, task.id, { scheduledDate: '2026-09-06', startAt: null, durationSeconds: 3600 });
  },
  addTask: async () => {
    const task = await useAppStore.getState().addTask({ title: 'Repeating study', recurrence: 'weekly', recurrence_days: [2,4], priority: 'medium' });
    useScheduleStore.getState().upsertTaskSchedule(id, task.id, { scheduledDate: '2026-09-08', startAt: localDateTimeToIso('2026-09-08','18:00','America/Los_Angeles'), durationSeconds: 1800,
      recurrence: 'weekly', recurrenceDays: [2,4], recurrenceEndDate: '2026-10-31' });
  },
} });
