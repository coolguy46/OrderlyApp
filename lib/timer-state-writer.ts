export interface TimerStateWriterOperations<State> {
  upsert(userId: string, state: State): Promise<unknown>;
  remove(userId: string): Promise<unknown>;
}

export interface SerializedTimerStateWriter<State> {
  begin(userId: string): number;
  save(userId: string, generation: number, state: State): Promise<void>;
  clear(userId: string): Promise<void>;
}

function assertSuccessfulWrite(result: unknown, operation: 'save' | 'clear'): void {
  // The Supabase service layer reports expected write failures with sentinels
  // instead of throwing. Treat those values as failures so callers never
  // discard the recoverable browser copy while the remote row is unchanged.
  if (result === null || result === false) {
    throw new Error(`Timer state ${operation} was not persisted`);
  }
}

/**
 * Serialize remote timer-state writes per account. A generation invalidates
 * checkpoint work from an older timer while preserving this ordering:
 * prior save -> reset delete -> any newly-started timer save.
 */
export function createSerializedTimerStateWriter<State>(
  operations: TimerStateWriterOperations<State>
): SerializedTimerStateWriter<State> {
  const generations = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();

  const enqueue = (userId: string, operation: () => Promise<unknown>): Promise<void> => {
    const previous = queues.get(userId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await operation();
      });
    queues.set(userId, next);
    void next.then(
      () => {
        if (queues.get(userId) === next) queues.delete(userId);
      },
      () => {
        if (queues.get(userId) === next) queues.delete(userId);
      }
    );
    return next;
  };

  return {
    begin(userId) {
      const generation = (generations.get(userId) ?? 0) + 1;
      generations.set(userId, generation);
      return generation;
    },

    save(userId, generation, state) {
      return enqueue(userId, async () => {
        if (generations.get(userId) !== generation) return;
        const result = await operations.upsert(userId, state);
        assertSuccessfulWrite(result, 'save');
      });
    },

    clear(userId) {
      generations.set(userId, (generations.get(userId) ?? 0) + 1);
      return enqueue(userId, async () => {
        const result = await operations.remove(userId);
        assertSuccessfulWrite(result, 'clear');
      });
    },
  };
}
