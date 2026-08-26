import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  hydrateCanvasDueDate,
  parseICalFile,
  type CanvasAssignment,
} from '@/lib/integrations/canvas';
import { isExamType } from '@/lib/utils';

const SUBJECT_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
];
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
// A first Canvas import can contain hundreds of events. Keeping this bounded
// avoids a long serial chain of Supabase requests without creating an
// unbounded burst (the background route also syncs a few users in parallel).
const ASSIGNMENT_SYNC_CONCURRENCY = 8;

export type CanvasSyncMode = 'manual' | 'background';

export interface CanvasSyncSetting {
  user_id: string;
  ical_url: string;
  last_sync_at: string | null;
  last_background_sync_at: string | null;
  last_background_attempt_at?: string | null;
  auto_sync_interval: number | null;
  time_zone: string | null;
}

export interface CanvasUserSyncResult {
  assignments: CanvasAssignment[];
  imported: number;
  updated: number;
  removed: number;
  examsImported: number;
  examsUpdated: number;
  orphanCleanupSkipped: boolean;
  lastSyncAt: string;
  lastBackgroundSyncAt: string | null;
}

interface LoadedCanvasAssignments {
  assignments: CanvasAssignment[];
  eventCount: number;
}

export interface CanvasFeedSummary {
  courses: number;
}

interface AssignmentSyncCounts {
  imported: number;
  updated: number;
  examsImported: number;
  examsUpdated: number;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateOrReservedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateOrReservedIpv4(address);
  if (version !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateOrReservedIpv4(mappedIpv4) : false;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      value => {
        cleanup();
        resolve(value);
      },
      error => {
        cleanup();
        reject(error);
      }
    );
  });
}

async function assertSafeFeedUrl(
  rawUrl: string,
  signal: AbortSignal
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Canvas feed URL is invalid');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Canvas feed URL must be a standard HTTPS URL');
  }
  if (!/^\/feeds\/calendars\/[^/]+\/?$/i.test(url.pathname)) {
    throw new Error('Use the Calendar Feed URL provided by Canvas');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (hostname !== 'instructure.com' && !hostname.endsWith('.instructure.com')) {
    throw new Error('Canvas feed URL must use an instructure.com host');
  }
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa')
  ) {
    throw new Error('Canvas feed URL cannot use a private hostname');
  }

  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('Canvas feed URL cannot use a private network address');
    }
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await withAbort(
      lookup(hostname, { all: true, verbatim: true }),
      signal
    );
  } catch {
    throw new Error('Canvas feed hostname could not be resolved');
  }

  if (addresses.length === 0 || addresses.some(result => isPrivateOrReservedIp(result.address))) {
    throw new Error('Canvas feed hostname resolved to a private network address');
  }

  return url;
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
    throw new Error('Canvas feed is larger than the 5 MB limit');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error('Canvas feed is larger than the 5 MB limit');
    }
    content += decoder.decode(value, { stream: true });
  }

  return content + decoder.decode();
}

async function fetchCanvasFeed(rawUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = await assertSafeFeedUrl(rawUrl, controller.signal);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await fetch(currentUrl, {
        headers: { Accept: 'text/calendar, text/plain;q=0.9' },
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error('Canvas feed redirected too many times');
        }
        const location = response.headers.get('location');
        if (!location) throw new Error('Canvas feed returned an invalid redirect');
        currentUrl = await assertSafeFeedUrl(
          new URL(location, currentUrl).toString(),
          controller.signal
        );
        continue;
      }

      if (!response.ok) {
        throw new Error(`Canvas feed returned ${response.status} ${response.statusText}`.trim());
      }

      const content = await readLimitedResponse(response);
      if (!/^BEGIN:VCALENDAR\s*$/mi.test(content) || !/^END:VCALENDAR\s*$/mi.test(content)) {
        throw new Error('Canvas feed did not return a valid iCalendar document');
      }
      return content;
    }

    throw new Error('Canvas feed could not be fetched');
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Canvas feed request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCanvasAssignments(icalUrl: string): Promise<LoadedCanvasAssignments> {
  const content = await fetchCanvasFeed(icalUrl);
  const eventCount = content.match(/^BEGIN:VEVENT\s*$/gmi)?.length || 0;
  const assignments = parseICalFile(content);

  if (eventCount > 0 && assignments.length === 0) {
    throw new Error('Canvas feed contained events that could not be parsed safely');
  }

  return { assignments, eventCount };
}

export async function getCanvasFeedSummary(icalUrl: string): Promise<CanvasFeedSummary> {
  const { assignments } = await loadCanvasAssignments(icalUrl);
  const courses = new Set(
    assignments
      .map(assignment => {
        if (assignment.courseId) return `id:${assignment.courseId}`;
        const courseName = assignment.courseName.trim().toLowerCase();
        // Canvas can omit the readable course label while still providing a
        // real course through the event URL. Keep one unknown identity as the
        // final fallback instead of silently dropping that course.
        return courseName ? `name:${courseName}` : null;
      })
      .filter((courseIdentity): courseIdentity is string => Boolean(courseIdentity))
  ).size;

  return { courses };
}

function canvasTaskChanged(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): boolean {
  return Object.entries(next).some(([key, value]) => {
    const current = existing[key];
    if (key === 'due_date' && typeof current === 'string' && typeof value === 'string') {
      return new Date(current).getTime() !== new Date(value).getTime();
    }
    return (current ?? null) !== (value ?? null);
  });
}

function dueTimeFor(assignment: CanvasAssignment, dueDate: Date, timeZone: string): string | null {
  if (assignment.dueDateOnly) return '23:59';
  if (!assignment.hasDueTime) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(dueDate).map(({ type, value }) => [type, value]));
    return `${parts.hour}:${parts.minute}`;
  } catch {
    return `${String(dueDate.getUTCHours()).padStart(2, '0')}:${String(dueDate.getUTCMinutes()).padStart(2, '0')}`;
  }
}

export async function syncCanvasUser(
  // The service-role client intentionally operates across user RLS boundaries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  setting: CanvasSyncSetting,
  mode: CanvasSyncMode
): Promise<CanvasUserSyncResult> {
  const { assignments, eventCount } = await loadCanvasAssignments(setting.ical_url);
  const currentIds = new Set(assignments.map(assignment => assignment.id));
  const currentExamIds = new Set(
    assignments
      .filter(assignment => isExamType(assignment.title, assignment.type))
      .map(assignment => assignment.id)
  );

  const [
    { data: existingSubjects, error: subjectError },
    { data: existingTasks, error: taskError },
    { data: existingExams, error: examError },
  ] = await Promise.all([
    admin.from('subjects').select('id, name').eq('user_id', setting.user_id),
    admin.from('tasks').select('*').eq('user_id', setting.user_id).eq('source', 'canvas'),
    admin
      .from('exams')
      .select('id, title, description, exam_date, subject_id, external_id')
      .eq('user_id', setting.user_id)
      .eq('source', 'canvas'),
  ]);

  if (subjectError) throw new Error(`Could not load subjects: ${subjectError.message}`);
  if (taskError) throw new Error(`Could not load Canvas tasks: ${taskError.message}`);
  if (examError) throw new Error(`Could not load exams: ${examError.message}`);

  const subjectIds = new Map<string, string>(
    (existingSubjects || []).map((subject: { id: string; name: string }) => [subject.name.toLowerCase(), subject.id])
  );
  const uniqueCourses = [...new Set(
    assignments
      .map(assignment => assignment.courseName)
      .filter(course => course && course !== 'Unknown Course')
  )];

  for (const courseName of uniqueCourses) {
    if (subjectIds.has(courseName.toLowerCase())) continue;
    const { data: created, error } = await admin
      .from('subjects')
      .insert({
        user_id: setting.user_id,
        name: courseName,
        color: SUBJECT_COLORS[subjectIds.size % SUBJECT_COLORS.length],
      })
      .select('id')
      .single();
    if (error) throw new Error(`Could not create subject: ${error.message}`);
    subjectIds.set(courseName.toLowerCase(), created.id);
  }

  const tasksByExternalId = new Map<string, Record<string, unknown>>(
    (existingTasks || [])
      .filter((task: Record<string, unknown>) => typeof task.external_id === 'string')
      .map((task: Record<string, unknown>) => [task.external_id as string, task])
  );
  const examsByExternalId = new Map<string, Record<string, unknown>>(
    (existingExams || [])
      .filter((exam: Record<string, unknown>) => typeof exam.external_id === 'string')
      .map((exam: Record<string, unknown>) => [exam.external_id as string, exam])
  );
  const now = new Date();

  // Canvas UIDs are the immutable identity for both tasks and exams. Process a
  // duplicate UID only once, then run independent UIDs concurrently. Each
  // worker still awaits its task mutation before its exam mutation.
  const uniqueAssignments = [...new Map(
    assignments.map(assignment => [assignment.id, assignment] as const)
  ).values()];
  const assignmentResults = await mapWithConcurrency(
    uniqueAssignments,
    ASSIGNMENT_SYNC_CONCURRENCY,
    async (assignment): Promise<AssignmentSyncCounts> => {
      const counts: AssignmentSyncCounts = {
        imported: 0,
        updated: 0,
        examsImported: 0,
        examsUpdated: 0,
      };
      const dueDate = hydrateCanvasDueDate(assignment, setting.time_zone || 'UTC');
      if (!dueDate) return counts;

      const existing = tasksByExternalId.get(assignment.id);
      if (!existing && dueDate < now) return counts;

      const resolvedCourseName = assignment.courseName !== 'Unknown Course'
        ? assignment.courseName
        : typeof existing?.course_name === 'string' ? existing.course_name : null;
      const subjectId = resolvedCourseName
        ? subjectIds.get(resolvedCourseName.toLowerCase()) || existing?.subject_id || null
        : existing?.subject_id || null;
      const taskValues = {
        title: `[Canvas] ${assignment.title}`,
        description: assignment.description || `Course: ${resolvedCourseName || 'Canvas'}`,
        due_date: dueDate.toISOString(),
        due_time: dueTimeFor(assignment, dueDate, setting.time_zone || 'UTC'),
        subject_id: subjectId,
        external_url: assignment.url || null,
        course_name: resolvedCourseName,
        assignment_type: assignment.type || 'assignment',
      };

      if (existing) {
        if (canvasTaskChanged(existing, taskValues)) {
          const { error } = await admin.from('tasks').update(taskValues).eq('id', existing.id);
          if (error) throw new Error(`Could not update Canvas task: ${error.message}`);
          counts.updated = 1;
        }
      } else {
        const { data: createdTasks, error } = await admin.from('tasks').upsert({
          user_id: setting.user_id,
          ...taskValues,
          priority: assignment.type === 'exam' ? 'high' : 'medium',
          status: 'pending',
          recurrence: 'none',
          recurrence_days: null,
          completed_at: null,
          source: 'canvas',
          external_id: assignment.id,
        }, {
          onConflict: 'user_id,source,external_id',
          ignoreDuplicates: true,
        }).select('id');
        if (error) throw new Error(`Could not import Canvas task: ${error.message}`);
        // ignoreDuplicates makes overlapping manual/background syncs safe. A
        // row is returned only when this invocation actually inserted it.
        counts.imported = createdTasks?.length ? 1 : 0;
      }

      // Canvas exams are identified by their immutable feed UID. Never match
      // by title: a user can have a manual exam with the exact same title.
      if (isExamType(assignment.title, assignment.type)) {
        const taskTitle = taskValues.title;
        const existingExam = examsByExternalId.get(assignment.id);

        if (existingExam) {
          const existingExamDate = typeof existingExam.exam_date === 'string'
            ? new Date(existingExam.exam_date).getTime()
            : null;
          const changed = existingExam.title !== taskTitle
            || (existingExam.description ?? null) !== taskValues.description
            || existingExamDate !== dueDate.getTime()
            || (existingExam.subject_id ?? null) !== subjectId;
          if (changed) {
            const { error } = await admin.from('exams').update({
              title: taskTitle,
              description: taskValues.description,
              exam_date: dueDate.toISOString(),
              subject_id: subjectId,
            }).eq('id', existingExam.id);
            if (error) throw new Error(`Could not update Canvas exam: ${error.message}`);
            Object.assign(existingExam, {
              title: taskTitle,
              description: taskValues.description,
              exam_date: dueDate.toISOString(),
              subject_id: subjectId,
            });
            counts.examsUpdated = 1;
          }
        } else if (dueDate >= now) {
          const { data: createdExams, error } = await admin.from('exams').upsert({
            user_id: setting.user_id,
            title: taskTitle,
            description: taskValues.description,
            exam_date: dueDate.toISOString(),
            subject_id: subjectId,
            source: 'canvas',
            external_id: assignment.id,
          }, {
            onConflict: 'user_id,source,external_id',
            ignoreDuplicates: true,
          }).select('id, title, description, exam_date, subject_id, external_id');
          if (error) throw new Error(`Could not import Canvas exam: ${error.message}`);
          const created = createdExams?.[0];
          if (created) {
            examsByExternalId.set(assignment.id, created);
            counts.examsImported = 1;
          }
        }
      }

      return counts;
    }
  );
  const {
    imported,
    updated,
    examsImported,
    examsUpdated,
  } = assignmentResults.reduce<AssignmentSyncCounts>((totals, counts) => ({
    imported: totals.imported + counts.imported,
    updated: totals.updated + counts.updated,
    examsImported: totals.examsImported + counts.examsImported,
    examsUpdated: totals.examsUpdated + counts.examsUpdated,
  }), {
    imported: 0,
    updated: 0,
    examsImported: 0,
    examsUpdated: 0,
  });

  // An empty, but syntactically valid, response can be caused by a transient
  // Canvas outage or permissions issue. A parser mismatch is equally unsafe:
  // never delete orphans unless every VEVENT became an assignment.
  const orphanCleanupSkipped = assignments.length === 0 || assignments.length !== eventCount;
  const orphanIds = orphanCleanupSkipped ? [] : (existingTasks || [])
    .filter((task: Record<string, unknown>) =>
      typeof task.external_id === 'string' && !currentIds.has(task.external_id)
    )
    .map((task: Record<string, unknown>) => task.id as string);
  if (orphanIds.length > 0) {
    const { error } = await admin.from('tasks').delete().in('id', orphanIds);
    if (error) throw new Error(`Could not remove old Canvas tasks: ${error.message}`);
  }

  const orphanExamIds = orphanCleanupSkipped ? [] : (existingExams || [])
    .filter((exam: Record<string, unknown>) =>
      typeof exam.external_id === 'string' && !currentExamIds.has(exam.external_id)
    )
    .map((exam: Record<string, unknown>) => exam.id as string);
  if (orphanExamIds.length > 0) {
    const { error } = await admin.from('exams').delete().in('id', orphanExamIds);
    if (error) throw new Error(`Could not remove old Canvas exams: ${error.message}`);
  }

  const lastSyncAt = new Date().toISOString();
  const lastBackgroundSyncAt = mode === 'background'
    ? lastSyncAt
    : setting.last_background_sync_at ?? null;
  const syncMarkers = mode === 'background'
    ? { last_sync_at: lastSyncAt, last_background_sync_at: lastBackgroundSyncAt }
    : { last_sync_at: lastSyncAt };
  const { error: settingsError } = await admin
    .from('canvas_settings')
    .update(syncMarkers)
    .eq('user_id', setting.user_id);
  if (settingsError) throw new Error(`Could not save sync time: ${settingsError.message}`);

  return {
    assignments,
    imported,
    updated,
    removed: orphanIds.length,
    examsImported,
    examsUpdated,
    orphanCleanupSkipped,
    lastSyncAt,
    lastBackgroundSyncAt,
  };
}
