export interface TaskDeletionResult {
  deletedTaskIds: string[];
  failedTaskIds: string[];
}
export async function deleteCreatedTasks(
  taskIds: readonly string[],
  deleteTask: (taskId: string) => Promise<boolean>,
): Promise<TaskDeletionResult> {
  const deletedTaskIds: string[] = [];
  const failedTaskIds: string[] = [];

  for (const taskId of taskIds) {
    let deleted = false;
    try {
      deleted = await deleteTask(taskId);
    } catch {
      deleted = false;
    }
    (deleted ? deletedTaskIds : failedTaskIds).push(taskId);
  }

  return { deletedTaskIds, failedTaskIds };
}

export function plannerMutationIsCurrent(input: {
  operationUserId: string;
  operationGeneration: number;
  currentUserId: string | null;
  currentGeneration: number;
}): boolean {
  return input.operationUserId === input.currentUserId
    && input.operationGeneration === input.currentGeneration;
}
