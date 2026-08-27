/**
 * A snapshot may drive cleanup only when every VEVENT produced one assignment.
 * Empty snapshots remain non-destructive because an outage or revoked feed can
 * otherwise look exactly like an authoritative empty calendar.
 */
export function isCompleteCanvasSnapshot(parsedAssignmentCount: number, eventCount: number): boolean {
  return parsedAssignmentCount > 0 && parsedAssignmentCount === eventCount;
}

export function countCanvasEventBoundaries(content: string): {
  beginCount: number;
  endCount: number;
} {
  return {
    beginCount: content.match(/^BEGIN:VEVENT\s*$/gmi)?.length || 0,
    endCount: content.match(/^END:VEVENT\s*$/gmi)?.length || 0,
  };
}

/** Compare stable Canvas identities without depending on response ordering. */
export function haveSameCanvasIdentities(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const identity of left) {
    if (!right.has(identity)) return false;
  }
  return true;
}

export interface CanvasSnapshotIdentity {
  parsedAssignmentCount: number;
  eventCount: number;
  taskIds: ReadonlySet<string>;
  examIds: ReadonlySet<string>;
}

/**
 * Destructive cleanup needs two independently fetched, structurally complete
 * snapshots with the same identities. Count equality alone is not enough: a
 * truncated feed can contain the same number of different events.
 */
export function isConfirmedCanvasCleanupSnapshot(
  primary: CanvasSnapshotIdentity,
  confirmation: CanvasSnapshotIdentity,
): boolean {
  return isCompleteCanvasSnapshot(primary.parsedAssignmentCount, primary.eventCount)
    && isCompleteCanvasSnapshot(confirmation.parsedAssignmentCount, confirmation.eventCount)
    && haveSameCanvasIdentities(primary.taskIds, confirmation.taskIds)
    && haveSameCanvasIdentities(primary.examIds, confirmation.examIds);
}
