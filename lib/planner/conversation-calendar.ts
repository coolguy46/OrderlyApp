import type { Database, Task } from '../supabase/types';
import { addLocalDays, buildScheduleOccurrences, localDateFromIso, localDateTimeToIso, localTimeFromIso } from '../schedule/selectors';
import { scheduleEntriesFromTasks } from '../schedule/persistence';
import type { ScheduleEntryInput } from '../schedule/types';
import { scheduleEventActionToCommitment } from '../schedule/commands';
import { buildCommitmentOccurrences, withCommitmentOccurrenceOverride } from './commitments';
import { plannerPersistenceSnapshotFromRows, recurringCommitmentInsert } from './persistence';
import { getDefaultPlannerSettings, type PlannerSettings, type RecurringCommitmentInput } from './types';
import { buildAssistantTaskPlan } from './assistant-planner';
import { plannerTaskDeadline } from './adapters';
import type { CalendarWrite, ConversationIntent, ConversationOperation, ConversationResult } from './conversation';
import { CalendarCapacityError, calendarRange, DEFAULT_CONTEXT_DAYS, MAX_CALENDAR_DAYS, validateCalendarRange, type CalendarDateRange } from './calendar-range';

type Tables = Database['public']['Tables'];
export interface ConversationSnapshot {
  tasks: Task[];
  events: Tables['recurring_commitments']['Row'][];
  preferences: Tables['planner_preferences']['Row'] | null;
  exams: Tables['exams']['Row'][];
  revision: string;
}
interface Interval { id: string; owner: string; title: string; startAt: string; endAt: string; sourceDate: string }
export interface ConversationCalendar {
  userId: string;
  now: string;
  settings: PlannerSettings;
  snapshot: ConversationSnapshot;
  localBusy?: Array<{ id: string; title: string; startAt: string; endAt: string }>;
  localEvents?: RecurringCommitmentInput[];
}
export function calendarFromSnapshot(snapshot: ConversationSnapshot, userId: string, now: string, timeZone: string): ConversationCalendar {
  if (snapshot.tasks.some(t => t.user_id !== userId) || snapshot.events.some(e => e.user_id !== userId)
    || snapshot.exams.some(e => e.user_id !== userId)
    || (snapshot.preferences && snapshot.preferences.user_id !== userId)) throw new Error('Account mismatch');
  const record = plannerPersistenceSnapshotFromRows(userId, snapshot.preferences, snapshot.events, []);
  return { userId, now, snapshot, settings: { ...getDefaultPlannerSettings(timeZone), ...record.settings } };
}
function commitments(calendar: ConversationCalendar): RecurringCommitmentInput[] {
  const saved = plannerPersistenceSnapshotFromRows(calendar.userId, null, calendar.snapshot.events, []).commitments;
  const s = calendar.settings;
  return [...saved, ...(calendar.localEvents || []).map(event => ({ ...event, id: `local-${event.id}` })), { id: 'school', title: 'School', kind: 'school', daysOfWeek: s.schoolDays,
    startTime: s.wakeTime, endTime: s.schoolHomeTime, timeZone: s.timeZone, enabled: true }];
}
export function calendarIntervals(calendar: ConversationCalendar, startDate: string, endDate: string): Interval[] {
  validateCalendarRange({ from: startDate, through: endDate });
  const zone = calendar.settings.timeZone;
  const tasks = calendar.snapshot.tasks.filter(task => task.status !== 'completed');
  const occurrences = buildScheduleOccurrences({ tasks, entries: scheduleEntriesFromTasks(tasks, calendar.userId), timeZone: zone, startDate, endDate });
  const taskIntervals = occurrences.timed.flatMap(item => item.startAt && item.endAt ? [{ id: item.id, owner: `task:${item.taskId}`, title: item.title, startAt: item.startAt, endAt: item.endAt, sourceDate: item.recurrenceSourceDate }] : []);
  const events = commitments(calendar).flatMap(event => buildCommitmentOccurrences(event, startDate, endDate).flatMap(item => {
    const eventZone = event.timeZone || zone;
    const startAt = localDateTimeToIso(item.date, `${item.startTime}:00`, eventZone);
    const endDate = item.endTime <= item.startTime ? addLocalDays(item.date, 1) : item.date;
    const endAt = localDateTimeToIso(endDate, `${item.endTime}:00`, eventZone);
    return startAt && endAt ? [{ id: item.id, owner: `event:${event.id}`, title: item.title, startAt, endAt, sourceDate: item.sourceDate }] : [];
  }));
  const intervals = [...taskIntervals, ...events, ...(calendar.localBusy || []).filter(item => {
    return localDateFromIso(item.startAt, zone)! <= endDate && localDateFromIso(item.endAt, zone)! >= startDate;
  }).map(item => ({ ...item, owner: `event:local-${item.id}`, sourceDate: localDateFromIso(item.startAt, zone)! }))];
  if (intervals.length > 10000) throw new CalendarCapacityError('This date range contains more than 10,000 calendar occurrences. Choose a shorter range; no partial changes were saved.');
  return intervals;
}

/** Compact facts without silently dropping pending/overdue tasks or stable IDs. */
export function conversationFacts(calendar: ConversationCalendar, receipts: unknown[], requestedRange?: CalendarDateRange) {
  const { now, settings, snapshot } = calendar;
  const today = localDateFromIso(now, settings.timeZone)!;
  const range = requestedRange ? validateCalendarRange(requestedRange) : calendarRange(today, DEFAULT_CONTEXT_DAYS);
  if (snapshot.tasks.length > 2000 || snapshot.events.length > 500) throw new CalendarCapacityError('This account exceeds the current Assistant context capacity (2,000 tasks or 500 events). No changes were made.');
  return {
    now, localNow: new Intl.DateTimeFormat('en-US', { timeZone: settings.timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(now)),
    today, settings,
    tasks: snapshot.tasks.map(task => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, source: task.source,
      description: task.description?.replace(/<[^>]*>/g, ' ').slice(0, 220), deadline: plannerTaskDeadline(task, settings.timeZone),
      overdue: task.status !== 'completed' && !!plannerTaskDeadline(task, settings.timeZone) && new Date(plannerTaskDeadline(task, settings.timeZone)!).getTime() < new Date(now).getTime(),
      date: task.scheduled_date, start: task.scheduled_start_at ? localTimeFromIso(task.scheduled_start_at, settings.timeZone) : null,
      durationMinutes: task.duration_seconds ? task.duration_seconds / 60 : null, recurrence: task.recurrence,
      days: task.recurrence_days, repeatUntil: task.schedule_recurrence_end_date,
      occurrenceOverrides: task.schedule_occurrence_overrides })),
    events: commitments(calendar),
    calendarRange: range,
    calendar: calendarIntervals(calendar, range.from, range.through),
    exams: snapshot.exams.map(exam => ({ title: exam.title, date: exam.exam_date, description: exam.description?.slice(0, 200) })),
    confirmedResults: receipts,
  };
}

function localInstant(date: string, clock: string, zone: string): string {
  const iso = localDateTimeToIso(date, `${clock}:00`, zone);
  if (!iso || localDateFromIso(iso, zone) !== date || localTimeFromIso(iso, zone) !== clock) {
    throw new Error(`${date} at ${clock} does not exist in ${zone} because the clocks change. Choose a nearby valid time.`);
  }
  // A clock repeated at the DST fall-back needs an explicit occurrence choice.
  for (const delta of [-3600000, 3600000]) {
    const other = new Date(new Date(iso).getTime() + delta).toISOString();
    if (localDateFromIso(other, zone) === date && localTimeFromIso(other, zone) === clock) throw new Error(`${date} at ${clock} happens twice when clocks change. Please choose a time outside that repeated hour.`);
  }
  return iso;
}
function scheduleFor(op: ConversationOperation, previous: ScheduleEntryInput | undefined, calendar: ConversationCalendar): ScheduleEntryInput {
  if (previous && op.action === 'update' && !op.date && !op.start && !op.end && !op.durationMinutes && !op.recurrence && !op.days && op.repeatUntil === undefined) return previous;
  const zone = calendar.settings.timeZone;
  const date = op.date || previous?.scheduledDate;
  const start = op.start || (previous?.startAt ? localTimeFromIso(previous.startAt, zone) : null);
  const recurrence = op.recurrence ?? previous?.recurrence ?? 'none';
  const recurrenceDays = op.days ?? previous?.recurrenceDays ?? (date ? [new Date(`${date}T12:00:00Z`).getUTCDay()] : []);
  const recurrenceEndDate = op.repeatUntil !== undefined ? op.repeatUntil : previous?.recurrenceEndDate ?? null;
  if (recurrence !== 'none' && recurrenceEndDate && date && recurrenceEndDate < date) throw new Error('The repeat end is before the first occurrence.');
  if (recurrence === 'weekly' && date && recurrenceEndDate) {
    const first = Array.from({ length: 7 }, (_, day) => addLocalDays(date, day))
      .find(value => recurrenceDays.includes(new Date(`${value}T12:00:00Z`).getUTCDay()));
    if (!first || first > recurrenceEndDate) throw new Error('No selected weekday falls within this repeat date range. Extend the end date or choose a weekday inside the range.');
  }
  const repeat = { recurrence, recurrenceDays: recurrence === 'weekly' ? recurrenceDays : null, recurrenceEndDate: recurrence === 'none' ? null : recurrenceEndDate };
  if (op.explicitStart && op.start !== op.explicitStart) throw new Error('The proposed start changed the explicitly requested AM/PM time. Preserve that time.');
  if (op.explicitEnd && op.end !== op.explicitEnd) throw new Error('The proposed end changed the explicitly requested AM/PM time. Preserve that time.');
  if (!date || !start) {
    if (op.entity === 'event' || start) throw new Error('What date and start time should this event use?');
    if (recurrence !== 'none' && !date) throw new Error('A repeating task needs a start date.');
    return { scheduledDate: date || null, startAt: null, durationSeconds: op.durationMinutes ? op.durationMinutes * 60 : previous?.durationSeconds ?? null, ...repeat };
  }
  const today = localDateFromIso(calendar.now, zone)!;
  const preservingSeriesAnchor = op.action === 'update' && op.wholeSeries && previous?.recurrence !== 'none' && !op.date;
  if (date < today && !preservingSeriesAnchor) throw new Error('Use a work date from today onward. The original deadline is not the work date.');
  const startAt = localInstant(date, start, zone);
  const anchorIsOccurrence = recurrence !== 'weekly' || recurrenceDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  if (!preservingSeriesAnchor && anchorIsOccurrence && new Date(startAt).getTime() < new Date(calendar.now).getTime()) throw new Error('That explicit start time has already passed. Ask whether to use another time; do not silently change AM/PM.');
  let durationSeconds = op.durationMinutes ? op.durationMinutes * 60 : previous?.durationSeconds;
  if (op.end) {
    if (op.end === start) throw new Error('Start and end are the same. Ask for the intended duration.');
    const endAt = localInstant(op.end < start ? addLocalDays(date, 1) : date, op.end, zone);
    durationSeconds = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000;
    if (op.durationMinutes && durationSeconds !== op.durationMinutes * 60) throw new Error('The duration contradicts the requested start/end times.');
  }
  if (!durationSeconds || durationSeconds <= 0 || durationSeconds > 86400) throw new Error('A valid duration or end time is needed. Estimate task work if reasonable, but ask for an uncertain event duration.');
  return { scheduledDate: date, startAt, durationSeconds, ...repeat };
}
function taskScheduleData(schedule: ScheduleEntryInput): Record<string, unknown> {
  return { scheduled_date: schedule.scheduledDate, scheduled_start_at: schedule.startAt, duration_seconds: schedule.durationSeconds,
    recurrence: schedule.recurrence, recurrence_days: schedule.recurrenceDays, schedule_recurrence_end_date: schedule.recurrenceEndDate };
}
function eventSchedule(event: RecurringCommitmentInput): ScheduleEntryInput {
  const date = event.startDate;
  const startAt = date ? localDateTimeToIso(date, `${event.startTime}:00`, event.timeZone || 'UTC') : null;
  const endAt = date ? localDateTimeToIso(event.endTime <= event.startTime ? addLocalDays(date, 1) : date, `${event.endTime}:00`, event.timeZone || 'UTC') : null;
  return { scheduledDate: date, startAt, durationSeconds: startAt && endAt ? (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000 : null,
    recurrence: event.endDate === event.startDate ? 'none' : 'weekly', recurrenceDays: event.daysOfWeek, recurrenceEndDate: event.endDate };
}
function applyWrites(calendar: ConversationCalendar, writes: CalendarWrite[]): ConversationCalendar {
  const copy = structuredClone(calendar);
  for (const write of writes) {
    if (write.entity === 'task') {
      const prior = copy.snapshot.tasks.find(task => task.id === write.id);
      copy.snapshot.tasks = copy.snapshot.tasks.filter(task => task.id !== write.id);
      if (write.op === 'put') copy.snapshot.tasks.push({ id: write.id, user_id: copy.userId, title: '', status: 'pending', priority: 'medium', source: 'manual', recurrence: 'none', due_date: null, due_time: null, ...prior, ...write.data } as Task);
    } else {
      const prior = copy.snapshot.events.find(event => event.client_commitment_id === write.id);
      copy.snapshot.events = copy.snapshot.events.filter(event => event.client_commitment_id !== write.id);
      if (write.op === 'put') copy.snapshot.events.push({ user_id: copy.userId, client_commitment_id: write.id, ...prior, ...write.data } as Tables['recurring_commitments']['Row']);
    }
  }
  return copy;
}

export interface CompiledConversation { writes: CalendarWrite[]; reply: string; items: ConversationResult['items'] }
export class RecurringScopeError extends Error {
  constructor() {
    super('Should I change just one occurrence or the entire repeating series?');
    this.name = 'RecurringScopeError';
  }
}

export class TaskDeletionIntentError extends Error {
  constructor() {
    super('I can remove the scheduled time while keeping the task and its deadline. Erasing the task from the Tasks list is a separate action available on the Tasks page.');
    this.name = 'TaskDeletionIntentError';
  }
}

export function conversationValidationFeedback(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The proposed operation was invalid.';
  if (error instanceof TaskDeletionIntentError) {
    return `${message} Review the user's intent: ordinary remove/cancel/take-off-calendar requests should be represented with action:remove for both tasks and events. Repair that representation without asking the user to say unschedule, and retain every named item in the bundle. If the user explicitly wants to erase the task record itself, explain the available Tasks-page action; do not silently replace it with schedule removal.`;
  }
  return error instanceof RecurringScopeError
    ? `${message} This is a missing structured scope, not necessarily missing user permission. Review the full conversation, including the question the user just answered. If the user already requested or confirmed the whole series, repair with wholeSeries:true; do not ask again. If a particular occurrence was requested, supply its original occurrenceDate. Only clarify if scope is genuinely unresolved. Never expose field names to the user.`
    : message;
}
export function compileConversation(intent: ConversationIntent, calendar: ConversationCalendar, newId: () => string = () => crypto.randomUUID()): CompiledConversation {
  if (intent.mode === 'inspect') throw new Error('Inspect the requested calendar range before compiling an answer.');
  if (intent.mode === 'discuss' || intent.mode === 'clarify') return { writes: [], reply: intent.reply, items: [] };
  const zone = calendar.settings.timeZone;
  const today = localDateFromIso(calendar.now, zone)!;
  const writes: CalendarWrite[] = [];
  const items: ConversationResult['items'] = [];
  const lines: string[] = [];
  const assumptions = [...intent.assumptions];
  const allowed = new Set<string>();
  const recordItem = (id: string, entity: 'task' | 'event', title: string, schedule?: ScheduleEntryInput) => {
    items.push({ id, entity, title, ...(schedule?.scheduledDate ? { date: schedule.scheduledDate } : {}) });
    const time = schedule?.startAt ? new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(schedule.startAt)) : schedule?.scheduledDate || 'unscheduled';
    const repeat = schedule?.recurrence && schedule.recurrence !== 'none'
      ? ` · repeats ${schedule.recurrence}${schedule.recurrence === 'weekly' ? ` on ${(schedule.recurrenceDays || []).map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}` : ''}${schedule.recurrenceEndDate ? ` through ${schedule.recurrenceEndDate}` : ''}` : '';
    lines.push(`**${title}** (${entity}) — ${time}${schedule?.durationSeconds ? ` · ${Math.round(schedule.durationSeconds / 60)} min` : ''}${repeat}`);
  };
  for (const operation of intent.operations) {
    const op = { ...operation };
    if (op.action === 'remove') op.action = op.entity === 'task' ? 'unschedule' : 'delete';
    if (op.action === 'unschedule' && op.entity === 'event') op.action = 'delete';
    if ((op.action === 'delete' || op.action === 'unschedule')
      && (op.days !== undefined || op.recurrence !== undefined || op.repeatUntil !== undefined)) {
      throw new Error('To change which weekdays repeat, update the repeat rule with the remaining weekdays. To remove one occurrence, choose its date; do not delete the series.');
    }
    const working = applyWrites(calendar, writes);
    const task = op.id ? working.snapshot.tasks.find(task => task.id === op.id) : undefined;
    const event = op.id && working.snapshot.events.some(row => row.client_commitment_id === op.id)
      ? commitments(working).find(event => event.id === op.id && event.kind !== 'school') : undefined;
    // Changing a repeat rule necessarily edits the series. Recognize an actual
    // rule change, not unchanged fields copied by the model. Never broaden an
    // explicitly single-occurrence operation or an ambiguous title/time edit.
    const existingSchedule = task ? scheduleEntriesFromTasks([task], calendar.userId)[0] : event ? eventSchedule(event) : undefined;
    if (op.action === 'update' && existingSchedule && existingSchedule.recurrence !== 'none'
      && op.wholeSeries === undefined && !op.occurrenceDate) {
      const ruleChanged = (op.recurrence !== undefined && op.recurrence !== existingSchedule.recurrence)
        || (op.days !== undefined && [...new Set(op.days)].sort().join(',') !== [...new Set(existingSchedule.recurrenceDays || [])].sort().join(','))
        || (op.repeatUntil !== undefined && op.repeatUntil !== (existingSchedule.recurrenceEndDate || null));
      if (ruleChanged) op.wholeSeries = true;
    }
    if (op.action !== 'create' && !task && !event) throw new Error('That item no longer exists in this account. Use a current item ID or ask which item.');
    if (op.action !== 'convert' && op.id && (op.entity === 'task' ? !task : !event)) throw new Error('The item type does not match its saved ID. Use convert to change type.');
    if (op.action === 'convert' && (op.entity === 'event' ? !task : !event)) throw new Error('This item is already the requested type. Update it instead of making a duplicate.');
    if (op.action === 'convert' && task && (task.source !== 'manual' || task.recurrence !== 'none' || task.due_date || task.status === 'completed')) throw new Error('This is an assignment or repeating/completed task, not a disposable calendar task. Keep its deadline/history and offer a separate event instead of deleting it.');
    if (op.action === 'convert' && event && eventSchedule(event).recurrence !== 'none') throw new Error('This is a repeating event. Ask whether to convert a single occurrence or keep the series; do not delete the series.');
    if (op.action === 'delete') {
      if (!event) throw new TaskDeletionIntentError();
      if (eventSchedule(event).recurrence !== 'none' && !op.wholeSeries) {
        if (!op.occurrenceDate) throw new RecurringScopeError();
        const targetDate = event.occurrenceOverrides?.[op.occurrenceDate]?.scheduledDate || op.occurrenceDate;
        if (!buildCommitmentOccurrences(event, targetDate, targetDate).some(item => item.sourceDate === op.occurrenceDate)) throw new Error('That occurrence does not exist or was already removed.');
        writes.push({ entity: 'event', op: 'put', id: event.id, data: recurringCommitmentInsert(calendar.userId, withCommitmentOccurrenceOverride(event, op.occurrenceDate, { skipped: true })) as Record<string, unknown> });
      } else writes.push({ entity: 'event', op: 'delete', id: event.id });
      lines.push(`Removed **${event.title}**${op.occurrenceDate && !op.wholeSeries ? ` on ${op.occurrenceDate}` : ''}.`);
      continue;
    }
    if (op.action === 'unschedule') {
      if (!task) throw new Error('Only tasks can be unscheduled.');
      const entry = existingSchedule;
      const repeating = entry?.recurrence !== 'none' && !!entry;
      const overrides = scheduleEntriesFromTasks([task], calendar.userId)[0]?.occurrenceOverrides || {};
      let scope = '';
      if (repeating && !op.wholeSeries) {
        if (!op.occurrenceDate) throw new RecurringScopeError();
        const target = overrides[op.occurrenceDate]?.scheduledDate || op.occurrenceDate;
        const occurrences = buildScheduleOccurrences({ tasks: [task], entries: scheduleEntriesFromTasks([task], calendar.userId),
          startDate: target, endDate: target, timeZone: zone });
        const occurrence = [...occurrences.timed, ...occurrences.untimed].find(item => item.recurrenceSourceDate === op.occurrenceDate);
        if (!occurrence) throw new Error('That recurring occurrence does not exist or was removed. Which date should come off the schedule?');
        writes.push({ entity: 'task', op: 'put', id: task.id, data: {
          schedule_occurrence_overrides: { ...overrides, [op.occurrenceDate]: { ...overrides[op.occurrenceDate], startAt: null } },
        } });
        scope = ` on ${occurrence.date}`;
      } else {
        writes.push({ entity: 'task', op: 'put', id: task.id, data: {
          scheduled_date: repeating ? entry.scheduledDate : null,
          scheduled_start_at: null,
          schedule_occurrence_overrides: Object.fromEntries(Object.entries(overrides).map(([date, override]) => [date, { ...override, startAt: null }])),
        } });
        scope = repeating ? ' (all occurrences)' : '';
      }
      lines.push(`Removed **${task.title}**${scope} from the schedule; it remains in Tasks with its deadline unchanged.`);
      continue;
    }
    let title = op.title || task?.title || event?.title;
    if (!title) throw new Error('A title is required.');
    let previous: ScheduleEntryInput | undefined = task ? scheduleEntriesFromTasks([task], calendar.userId)[0] : event ? eventSchedule(event) : undefined;
    const editingOccurrence = previous?.recurrence !== 'none' && previous && !op.wholeSeries && op.action === 'update';
    if (editingOccurrence && !op.occurrenceDate) throw new RecurringScopeError();
    if (editingOccurrence && (op.recurrence !== undefined || op.days !== undefined || op.repeatUntil !== undefined)) throw new Error('Repeat settings affect the whole series. Ask whether to change the entire series.');
    if (editingOccurrence && op.occurrenceDate) {
      const taskOverride = task ? scheduleEntriesFromTasks([task], calendar.userId)[0]?.occurrenceOverrides[op.occurrenceDate] : undefined;
      const targetDate = event?.occurrenceOverrides?.[op.occurrenceDate]?.scheduledDate || taskOverride?.scheduledDate || op.occurrenceDate;
      const taskOccurrences = task ? buildScheduleOccurrences({ tasks: [task], entries: scheduleEntriesFromTasks([task], calendar.userId), timeZone: zone, startDate: targetDate, endDate: targetDate }) : null;
      const currentTask = taskOccurrences ? [...taskOccurrences.timed, ...taskOccurrences.untimed].find(item => item.recurrenceSourceDate === op.occurrenceDate) : null;
      const currentEvent = event ? calendarIntervals(working, targetDate, targetDate).find(item => item.owner === `event:${op.id}` && item.sourceDate === op.occurrenceDate) : null;
      if (!currentTask && !currentEvent) throw new Error('That recurring occurrence does not exist or was removed. Ask which occurrence should change.');
      title = op.title || currentTask?.title || currentEvent?.title || title;
      previous = { ...previous, recurrence: 'none', recurrenceDays: null, recurrenceEndDate: null,
        scheduledDate: currentTask ? currentTask.date : localDateFromIso(currentEvent!.startAt, zone),
        startAt: currentTask ? currentTask.startAt : currentEvent!.startAt,
        durationSeconds: currentTask ? currentTask.durationSeconds : (Date.parse(currentEvent!.endAt) - Date.parse(currentEvent!.startAt)) / 1000 };
    }
    const schedule = scheduleFor(op, previous, calendar);
    const id = op.action === 'create' || op.action === 'convert' ? newId() : op.id!;
    const description = op.description ?? task?.description ?? event?.description ?? null;
    if (op.entity === 'task') {
      const data: Record<string, unknown> = { title, description, ...taskScheduleData(schedule) };
      if (editingOccurrence && task) {
        const overrides = task.schedule_occurrence_overrides && typeof task.schedule_occurrence_overrides === 'object' ? task.schedule_occurrence_overrides : {};
        for (const key of Object.keys(taskScheduleData(schedule))) delete data[key];
        delete data.title;
        delete data.description;
        const prior = scheduleEntriesFromTasks([task], calendar.userId)[0]?.occurrenceOverrides[op.occurrenceDate!] || {};
        data.schedule_occurrence_overrides = { ...overrides, [op.occurrenceDate!]: { ...prior, scheduledDate: schedule.scheduledDate, startAt: schedule.startAt, durationSeconds: schedule.durationSeconds,
          ...(op.title !== undefined ? { title } : {}), ...(op.description !== undefined ? { description } : {}) } };
      }
      writes.push({ entity: 'task', op: 'put', id, data });
    } else {
      const commitment = scheduleEventActionToCommitment({ type: 'create_event', title, description, kind: event?.kind || 'personal', schedule }, { id, timeZone: zone, updatedAt: calendar.now });
      if (!commitment) throw new Error('An event needs a valid start, duration, and supported repeat rule.');
      const updated = editingOccurrence && event
        ? withCommitmentOccurrenceOverride(event, op.occurrenceDate!, { scheduledDate: schedule.scheduledDate, startTime: commitment.startTime, endTime: commitment.endTime,
          ...(op.title !== undefined ? { title } : {}), ...(op.description !== undefined ? { description } : {}) })
        : { ...event, ...commitment };
      writes.push({ entity: 'event', op: 'put', id, data: recurringCommitmentInsert(calendar.userId, updated) as Record<string, unknown> });
    }
    if (op.action === 'convert') writes.push({ entity: task ? 'task' : 'event', op: 'delete', id: op.id! });
    if (op.allowOverlap) allowed.add(`${op.entity}:${id}`);
    if (op.estimatedDuration) assumptions.push(`I estimated ${Math.round((schedule.durationSeconds || 0) / 60)} minutes for ${title}; you can adjust it.`);
    if (task && plannerTaskDeadline(task, zone) && schedule.startAt && new Date(schedule.startAt).getTime() + (schedule.durationSeconds || 0) * 1000 > new Date(plannerTaskDeadline(task, zone)!).getTime()) assumptions.push(`${title}'s original deadline stays unchanged; this is catch-up work.`);
    recordItem(id, op.entity, title, schedule);
  }
  if (intent.plan) {
    const working = applyWrites(calendar, writes);
    if (intent.plan.taskIds.some(id => !working.snapshot.tasks.some(t => t.id === id))) throw new Error('The plan refers to a task outside the current account.');
    const startDate = intent.plan.startDate || (intent.plan.taskScope === 'tomorrow' ? addLocalDays(today, 1) : today);
    if (startDate < today) throw new Error('That planning window starts in the past. Choose a start date from today onward; the requested window was not shifted automatically.');
    const rangeEnd = calendarRange(startDate, intent.plan.horizonDays).through;
    const entries = scheduleEntriesFromTasks(working.snapshot.tasks, calendar.userId);
    const occurrences = buildScheduleOccurrences({ tasks: working.snapshot.tasks.filter(t => t.status !== 'completed'), entries, timeZone: zone, startDate, endDate: rangeEnd });
    // Fixed times in this same request are already reserved. A broad replan
    // must not select and relocate those items again; keep their occurrences
    // as busy intervals while planning the remaining work around them.
    const fixedTaskIds = new Set(items.filter(item => item.entity === 'task').map(item => item.id));
    const preview = buildAssistantTaskPlan({ request: intent.plan, now: calendar.now, timeZone: zone, tasks: working.snapshot.tasks.filter(task => !fixedTaskIds.has(task.id)), entries,
      occurrences: [...occurrences.timed, ...occurrences.untimed], busy: calendarIntervals(working, startDate, rangeEnd).filter(i => i.owner.startsWith('event:')), settings: calendar.settings });
    if (preview.status !== 'ready') throw new Error(`${preview.summary} ${preview.assumptions.join(' ')} Suggest a specific alternative without dropping the constraints.`);
    // Do not save an incomplete mixed request as if all requirements succeeded.
    if (preview.assumptions.some(a => a.startsWith('I scheduled only the work that fit.'))) throw new Error(preview.assumptions.filter(a => a.startsWith('I scheduled only')).join(' ') + ' Ask whether to extend the planning window or reduce the work; no partial changes were saved.');
    for (const action of preview.actions) {
      if (action.type === 'create_task') {
        const id = newId();
        writes.push({ entity: 'task', op: 'put', id, data: { title: action.title, description: action.description, ...taskScheduleData(action.schedule) } });
        recordItem(id, 'task', action.title, action.schedule);
      } else if (action.type === 'schedule_batch') {
        for (const operation of action.operations) {
          const task = working.snapshot.tasks.find(t => t.id === operation.taskId)!;
          if (operation.type === 'upsert') {
            const previous = entries.find(e => e.taskId === task.id);
            const schedule = { ...previous, ...operation.input };
            writes.push({ entity: 'task', op: 'put', id: task.id, data: taskScheduleData(schedule) });
            recordItem(task.id, 'task', task.title, schedule);
          } else if (operation.type === 'override') {
            const current = task.schedule_occurrence_overrides || {};
            writes.push({ entity: 'task', op: 'put', id: task.id, data: { schedule_occurrence_overrides: { ...(current as object), [operation.occurrenceDate]: operation.override } } });
            recordItem(task.id, 'task', task.title, operation.override);
          }
        }
      }
    }
    assumptions.push(...preview.assumptions, 'Work durations without your own estimate are estimated; you can ask me to change them.');
  }
  // Validate the FINAL bundle, so swapping two blocks does not conflict with
  // their old positions and new items in the same request cannot overlap.
  const after = applyWrites(calendar, writes);
  if (writes.length > 60) throw new Error('This request needs more than 60 calendar writes. Please split the work into smaller groups; no partial changes were saved.');
  const ranges: CalendarDateRange[] = [];
  for (const write of writes.filter(write => write.op === 'put')) {
    const task = after.snapshot.tasks.find(task => write.entity === 'task' && task.id === write.id);
    const event = commitments(after).find(event => write.entity === 'event' && event.id === write.id);
    const schedule = task ? scheduleEntriesFromTasks([task], calendar.userId)[0] : event ? eventSchedule(event) : undefined;
    if (schedule?.scheduledDate && schedule.startAt) {
      const repeating = schedule.recurrence && schedule.recurrence !== 'none';
      const from = repeating && schedule.scheduledDate < today ? today : schedule.scheduledDate;
      const limit = addLocalDays(from, MAX_CALENDAR_DAYS - 1);
      const through = repeating ? (schedule.recurrenceEndDate && schedule.recurrenceEndDate < limit ? schedule.recurrenceEndDate : limit) : from;
      if (through >= from) ranges.push({ from, through });
      if (repeating && (!schedule.recurrenceEndDate || schedule.recurrenceEndDate > limit)) {
        assumptions.push(`This series keeps repeating${schedule.recurrenceEndDate ? ` until ${schedule.recurrenceEndDate}` : ''}. Conflicts were checked through ${limit}; later occurrences are generated when you view those dates.`);
      }
    }
    // A moved occurrence can be years away from its original series anchor.
    // Check its actual target as well, without expanding the intervening years.
    const overrides = task ? scheduleEntriesFromTasks([task], calendar.userId)[0]?.occurrenceOverrides : event?.occurrenceOverrides;
    for (const [source, override] of Object.entries(overrides || {})) {
      const target = override.scheduledDate || source;
      const hasTime = 'startAt' in override ? !!override.startAt : !!schedule?.startAt;
      if (!override.skipped && hasTime) ranges.push({ from: target, through: target });
    }
  }
  const expand = (state: ConversationCalendar) => {
    const result = new Map<string, Interval>();
    const merged: CalendarDateRange[] = [];
    for (const range of ranges.sort((a, b) => a.from.localeCompare(b.from))) {
      const previous = merged.at(-1);
      if (previous && range.from <= addLocalDays(previous.through, 1)) previous.through = previous.through > range.through ? previous.through : range.through;
      else merged.push({ ...range });
    }
    for (const range of merged) {
      // Include adjacent days so overnight and different-timezone collisions
      // cannot disappear at the left or right edge of a requested window.
      const end = addLocalDays(range.through, 1);
      for (let from = addLocalDays(range.from, -1); from <= end;) {
        const limit = addLocalDays(from, MAX_CALENDAR_DAYS - 1);
        const through = limit < end ? limit : end;
        for (const interval of calendarIntervals(state, from, through)) result.set(interval.id, interval);
        from = addLocalDays(through, 1);
      }
    }
    return [...result.values()];
  };
  const key = (item: Interval) => `${item.owner}|${item.sourceDate}|${item.startAt}|${item.endAt}`;
  const baseline = new Set(expand(calendar).map(key));
  const final = expand(after).sort((a, b) => a.startAt.localeCompare(b.startAt));
  let active: Interval[] = [];
  for (const interval of final) {
    active = active.filter(other => other.endAt > interval.startAt);
    const changed = !baseline.has(key(interval)) && !allowed.has(interval.owner);
    const collision = active.find(other => changed || (!baseline.has(key(other)) && !allowed.has(other.owner)));
    if (collision) throw new Error(`${interval.title} (${interval.startAt}–${interval.endAt}) really overlaps ${collision.title} (${collision.startAt}–${collision.endAt}), in timezone ${zone}. Keep explicit requested times and ask about the real conflict or offer a free alternative.`);
    active.push(interval);
  }
  return { writes, items, reply: `Saved to your calendar:\n\n${lines.map(line => `- ${line}`).join('\n')}\n\n${[...new Set(assumptions)].join('\n\n')}`.trim() };
}
