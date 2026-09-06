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
}
export function calendarFromSnapshot(snapshot: ConversationSnapshot, userId: string, now: string, timeZone: string): ConversationCalendar {
  if (snapshot.tasks.some(t => t.user_id !== userId) || snapshot.events.some(e => e.user_id !== userId)) throw new Error('Account mismatch');
  const record = plannerPersistenceSnapshotFromRows(userId, snapshot.preferences, snapshot.events, []);
  return { userId, now, snapshot, settings: { ...getDefaultPlannerSettings(timeZone), ...record.settings } };
}
function commitments(calendar: ConversationCalendar): RecurringCommitmentInput[] {
  const saved = plannerPersistenceSnapshotFromRows(calendar.userId, null, calendar.snapshot.events, []).commitments;
  const s = calendar.settings;
  return [...saved, { id: 'school', title: 'School', kind: 'school', daysOfWeek: s.schoolDays,
    startTime: s.wakeTime, endTime: s.schoolHomeTime, timeZone: s.timeZone, enabled: true }];
}
function calendarIntervals(calendar: ConversationCalendar, startDate: string, endDate: string): Interval[] {
  const zone = calendar.settings.timeZone;
  const tasks = calendar.snapshot.tasks.filter(task => task.status !== 'completed');
  const occurrences = buildScheduleOccurrences({ tasks, entries: scheduleEntriesFromTasks(tasks, calendar.userId), timeZone: zone, startDate, endDate });
  const taskIntervals = occurrences.timed.flatMap(item => item.startAt && item.endAt ? [{ id: item.id, owner: `task:${item.taskId}`, title: item.title, startAt: item.startAt, endAt: item.endAt, sourceDate: item.recurrenceSourceDate }] : []);
  const events = commitments(calendar).flatMap(event => buildCommitmentOccurrences(event, startDate, endDate).flatMap(item => {
    const eventZone = event.timeZone || zone;
    const startAt = localDateTimeToIso(item.date, `${item.startTime}:00`, eventZone);
    const endDate = item.endTime <= item.startTime ? addLocalDays(item.date, 1) : item.date;
    const endAt = localDateTimeToIso(endDate, `${item.endTime}:00`, eventZone);
    return startAt && endAt ? [{ id: item.id, owner: `event:${event.id}`, title: event.title, startAt, endAt, sourceDate: item.sourceDate }] : [];
  }));
  return [...taskIntervals, ...events, ...(calendar.localBusy || []).map(item => ({ ...item, owner: `event:local-${item.id}`, sourceDate: localDateFromIso(item.startAt, zone)! }))];
}

/** Compact facts without silently dropping pending/overdue tasks or stable IDs. */
export function conversationFacts(calendar: ConversationCalendar, receipts: unknown[]) {
  const { now, settings, snapshot } = calendar;
  const today = localDateFromIso(now, settings.timeZone)!;
  if (snapshot.tasks.length > 2000 || snapshot.events.length > 500) throw new Error('This account is too large for the current Assistant context. No changes were made.');
  return {
    now, localNow: new Intl.DateTimeFormat('en-US', { timeZone: settings.timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(now)),
    today, settings,
    tasks: snapshot.tasks.map(task => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, source: task.source,
      description: task.description?.replace(/<[^>]*>/g, ' ').slice(0, 220), deadline: plannerTaskDeadline(task, settings.timeZone),
      overdue: task.status !== 'completed' && !!plannerTaskDeadline(task, settings.timeZone) && new Date(plannerTaskDeadline(task, settings.timeZone)!).getTime() < new Date(now).getTime(),
      date: task.scheduled_date, start: task.scheduled_start_at ? localTimeFromIso(task.scheduled_start_at, settings.timeZone) : null,
      durationMinutes: task.duration_seconds ? task.duration_seconds / 60 : null, recurrence: task.recurrence })),
    events: commitments(calendar),
    calendarRange: { from: today, through: addLocalDays(today, 14) },
    calendar: calendarIntervals(calendar, today, addLocalDays(today, 14)),
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
  if (previous && op.action === 'update' && !op.date && !op.start && !op.end && !op.durationMinutes && !op.recurrence && !op.days && !op.repeatUntil) return previous;
  const zone = calendar.settings.timeZone;
  const date = op.date || previous?.scheduledDate;
  const start = op.start || (previous?.startAt ? localTimeFromIso(previous.startAt, zone) : null);
  if (op.explicitStart && op.start !== op.explicitStart) throw new Error('The proposed start changed the explicitly requested AM/PM time. Preserve that time.');
  if (op.explicitEnd && op.end !== op.explicitEnd) throw new Error('The proposed end changed the explicitly requested AM/PM time. Preserve that time.');
  if (!date || !start) {
    if (op.entity === 'event' || start) throw new Error('What date and start time should this event use?');
    return { scheduledDate: date || null, startAt: null, durationSeconds: op.durationMinutes ? op.durationMinutes * 60 : null, recurrence: op.recurrence || 'none' };
  }
  const today = localDateFromIso(calendar.now, zone)!;
  if (date < today || date > addLocalDays(today, 365)) throw new Error('Use a work date from today through the next year. The original deadline is not the work date.');
  const startAt = localInstant(date, start, zone);
  if (new Date(startAt).getTime() < new Date(calendar.now).getTime()) throw new Error('That explicit start time has already passed. Ask whether to use another time; do not silently change AM/PM.');
  let durationSeconds = op.durationMinutes ? op.durationMinutes * 60 : previous?.durationSeconds;
  if (op.end) {
    if (op.end === start) throw new Error('Start and end are the same. Ask for the intended duration.');
    const endAt = localInstant(op.end < start ? addLocalDays(date, 1) : date, op.end, zone);
    durationSeconds = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000;
    if (op.durationMinutes && durationSeconds !== op.durationMinutes * 60) throw new Error('The duration contradicts the requested start/end times.');
  }
  if (!durationSeconds || durationSeconds <= 0 || durationSeconds > 86400) throw new Error('A valid duration or end time is needed. Estimate task work if reasonable, but ask for an uncertain event duration.');
  const recurrence = op.recurrence ?? previous?.recurrence ?? 'none';
  const recurrenceDays = op.days ?? previous?.recurrenceDays ?? [new Date(`${date}T12:00:00Z`).getUTCDay()];
  if (op.repeatUntil && op.repeatUntil < date) throw new Error('The repeat end is before the first occurrence.');
  return { scheduledDate: date, startAt, durationSeconds, recurrence, recurrenceDays: recurrence === 'weekly' ? recurrenceDays : null, recurrenceEndDate: op.repeatUntil ?? previous?.recurrenceEndDate ?? null };
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
export function compileConversation(intent: ConversationIntent, calendar: ConversationCalendar, newId: () => string = () => crypto.randomUUID()): CompiledConversation {
  if (intent.mode === 'discuss' || intent.mode === 'clarify') return { writes: [], reply: intent.reply, items: [] };
  const zone = calendar.settings.timeZone;
  const today = localDateFromIso(calendar.now, zone)!;
  const writes: CalendarWrite[] = [];
  const items: ConversationResult['items'] = [];
  const lines: string[] = [];
  const assumptions = [...intent.assumptions];
  const allowed = new Set<string>();
  const recordItem = (id: string, entity: 'task' | 'event', title: string, schedule?: ScheduleEntryInput) => {
    items.push({ id, entity, title });
    const time = schedule?.startAt ? new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(schedule.startAt)) : schedule?.scheduledDate || 'unscheduled';
    lines.push(`**${title}** (${entity}) — ${time}${schedule?.durationSeconds ? ` · ${Math.round(schedule.durationSeconds / 60)} min` : ''}`);
  };
  for (const op of intent.operations) {
    const working = applyWrites(calendar, writes);
    const task = op.id ? working.snapshot.tasks.find(task => task.id === op.id) : undefined;
    const event = op.id ? commitments(working).find(event => event.id === op.id && event.kind !== 'school') : undefined;
    if (op.action !== 'create' && !task && !event) throw new Error('That item no longer exists in this account. Use a current item ID or ask which item.');
    if (op.action !== 'convert' && op.id && (op.entity === 'task' ? !task : !event)) throw new Error('The item type does not match its saved ID. Use convert to change type.');
    if (op.action === 'convert' && (op.entity === 'event' ? !task : !event)) throw new Error('This item is already the requested type. Update it instead of making a duplicate.');
    if (op.action === 'convert' && task && (task.source !== 'manual' || task.recurrence !== 'none' || task.due_date || task.status === 'completed')) throw new Error('This is an assignment or repeating/completed task, not a disposable calendar task. Keep its deadline/history and offer a separate event instead of deleting it.');
    if (op.action === 'convert' && event && eventSchedule(event).recurrence !== 'none') throw new Error('This is a repeating event. Ask whether to convert a single occurrence or keep the series; do not delete the series.');
    if (op.action === 'delete') {
      if (!event) throw new Error('Task deletion is not supported in chat. Use unschedule to keep the assignment.');
      if (eventSchedule(event).recurrence !== 'none' && !op.wholeSeries) {
        if (!op.occurrenceDate) throw new Error('Which occurrence should be removed?');
        writes.push({ entity: 'event', op: 'put', id: event.id, data: recurringCommitmentInsert(calendar.userId, withCommitmentOccurrenceOverride(event, op.occurrenceDate, { skipped: true })) as Record<string, unknown> });
      } else writes.push({ entity: 'event', op: 'delete', id: event.id });
      lines.push(`Removed **${event.title}**${op.occurrenceDate && !op.wholeSeries ? ` on ${op.occurrenceDate}` : ''}.`);
      continue;
    }
    if (op.action === 'unschedule') {
      if (!task) throw new Error('Only tasks can be unscheduled.');
      if (task.recurrence !== 'none') throw new Error('Specify a recurring occurrence to move instead of unscheduling the whole series.');
      writes.push({ entity: 'task', op: 'put', id: task.id, data: { scheduled_date: null, scheduled_start_at: null } });
      lines.push(`Unscheduled **${task.title}**; the task and its deadline are unchanged.`);
      continue;
    }
    const title = op.title || task?.title || event?.title;
    if (!title) throw new Error('A title is required.');
    let previous: ScheduleEntryInput | undefined = task ? scheduleEntriesFromTasks([task], calendar.userId)[0] : event ? eventSchedule(event) : undefined;
    const editingOccurrence = previous?.recurrence !== 'none' && previous && !op.wholeSeries && op.action === 'update';
    if (editingOccurrence && !op.occurrenceDate) throw new Error('Which date of this repeating item should change? Use occurrenceDate, or wholeSeries only when requested.');
    if (editingOccurrence && op.occurrenceDate) {
      const current = calendarIntervals(working, addLocalDays(op.occurrenceDate, -1), addLocalDays(op.occurrenceDate, 1))
        .find(item => item.owner === `${op.entity}:${op.id}` && item.sourceDate === op.occurrenceDate);
      if (!current) throw new Error('That recurring occurrence was removed or moved outside this date. Ask for its current date.');
      previous = { ...previous, scheduledDate: localDateFromIso(current.startAt, zone), startAt: current.startAt, durationSeconds: (Date.parse(current.endAt) - Date.parse(current.startAt)) / 1000 };
    }
    const schedule = scheduleFor(op, previous, calendar);
    const id = op.action === 'create' || op.action === 'convert' ? newId() : op.id!;
    const description = op.description ?? task?.description ?? event?.description ?? null;
    if (op.entity === 'task') {
      const data: Record<string, unknown> = { title, description, ...taskScheduleData(schedule) };
      if (editingOccurrence && task) {
        const overrides = task.schedule_occurrence_overrides && typeof task.schedule_occurrence_overrides === 'object' ? task.schedule_occurrence_overrides : {};
        for (const key of Object.keys(taskScheduleData(schedule))) delete data[key];
        data.schedule_occurrence_overrides = { ...overrides, [op.occurrenceDate!]: { scheduledDate: schedule.scheduledDate, startAt: schedule.startAt, durationSeconds: schedule.durationSeconds } };
      }
      writes.push({ entity: 'task', op: 'put', id, data });
    } else {
      const commitment = scheduleEventActionToCommitment({ type: 'create_event', title, description, kind: event?.kind || 'personal', schedule }, { id, timeZone: zone, updatedAt: calendar.now });
      if (!commitment) throw new Error('An event needs a valid start, duration, and supported repeat rule.');
      const updated = editingOccurrence && event
        ? { ...withCommitmentOccurrenceOverride(event, op.occurrenceDate!, { scheduledDate: schedule.scheduledDate, startTime: commitment.startTime, endTime: commitment.endTime }), title, description }
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
    const startDate = intent.plan.startDate || today;
    const rangeEnd = addLocalDays(startDate, intent.plan.horizonDays);
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
  const lastDate = [...items.flatMap(item => {
    const t = after.snapshot.tasks.find(t => t.id === item.id);
    const e = after.snapshot.events.find(e => e.client_commitment_id === item.id);
    return [t?.scheduled_date || e?.start_date || today];
  }), addLocalDays(today, 60)].sort().at(-1)!;
  const rangeEnd = addLocalDays(lastDate, 60);
  const baseline = calendarIntervals(calendar, addLocalDays(today, -1), rangeEnd);
  const final = calendarIntervals(after, addLocalDays(today, -1), rangeEnd);
  const same = (a: Interval, b: Interval) => a.owner === b.owner && a.sourceDate === b.sourceDate && a.startAt === b.startAt && a.endAt === b.endAt;
  const changed = final.filter(item => !baseline.some(old => same(old, item)));
  for (const interval of changed) {
    if (allowed.has(interval.owner)) continue;
    const collision = final.find(other => other !== interval && new Date(interval.startAt) < new Date(other.endAt) && new Date(interval.endAt) > new Date(other.startAt));
    if (collision) throw new Error(`${interval.title} (${interval.startAt}–${interval.endAt}) really overlaps ${collision.title} (${collision.startAt}–${collision.endAt}), in timezone ${zone}. Keep explicit requested times and ask about the real conflict or offer a free alternative.`);
  }
  return { writes, items, reply: `Saved to your calendar:\n\n${lines.map(line => `- ${line}`).join('\n')}\n\n${[...new Set(assumptions)].join('\n\n')}`.trim() };
}
