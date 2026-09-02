import type { ScheduleEntry } from './types';

function entryMap(entries: readonly ScheduleEntry[]): Map<string, ScheduleEntry> {
  return new Map(entries.map(entry => [entry.taskId, entry]));
}
function entriesMatch(
  left: ScheduleEntry | undefined,
  right: ScheduleEntry | undefined,
): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Reverts only the schedule entries that still match the state written by the
 * operation being undone. This is a three-way restore: `before` is the old
 * snapshot, `applied` is the operation's committed snapshot, and `current` is
 * read immediately before rollback. Entries changed after the operation are
 * deliberately preserved instead of being erased by a stale full snapshot.
 */
export function restoreScheduleSnapshotPreservingChanges(
  before: readonly ScheduleEntry[],
  applied: readonly ScheduleEntry[],
  current: readonly ScheduleEntry[],
): {
  entries: ScheduleEntry[];
  restoredTaskIds: string[];
  skippedTaskIds: string[];
} {
  const beforeByTask = entryMap(before);
  const appliedByTask = entryMap(applied);
  const currentByTask = entryMap(current);
  const restoredTaskIds: string[] = [];
  const skippedTaskIds: string[] = [];
  const operationTaskIds = new Set([
    ...beforeByTask.keys(),
    ...appliedByTask.keys(),
  ]);

  for (const taskId of operationTaskIds) {
    const previous = beforeByTask.get(taskId);
    const operationValue = appliedByTask.get(taskId);
    if (entriesMatch(previous, operationValue)) continue;

    const currentValue = currentByTask.get(taskId);
    if (!entriesMatch(currentValue, operationValue) && !entriesMatch(currentValue, previous)) {
      skippedTaskIds.push(taskId);
      continue;
    }

    if (previous) currentByTask.set(taskId, previous);
    else currentByTask.delete(taskId);
    restoredTaskIds.push(taskId);
  }

  return {
    entries: [...currentByTask.values()],
    restoredTaskIds,
    skippedTaskIds,
  };
}
