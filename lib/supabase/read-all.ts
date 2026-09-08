import { withTimeout } from '@/lib/auth/lifecycle';

/** Read a complete owned collection, not just the database's first result page. */
export async function readAllOwnedRows<T extends { id: string; user_id: string }>(
  userId: string,
  readPage: (cursor: string | null, signal: AbortSignal) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const controller = new AbortController();
  const read = async () => {
    const rows: T[] = [];
    let cursor: string | null = null;
    while (true) {
      controller.signal.throwIfAborted();
      const { data, error }: { data: T[] | null; error: unknown } = await readPage(cursor, controller.signal);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Incomplete collection response');
      if (data.length === 0) return rows;
      for (const row of data) {
        if (row.user_id !== userId || typeof row.id !== 'string' || (cursor !== null && row.id <= cursor)) {
          throw new Error('Collection ownership or pagination mismatch');
        }
        rows.push(row);
        cursor = row.id;
      }
    }
  };
  try {
    return await withTimeout(read(), 14_000, 'Loading saved records');
  } finally {
    controller.abort();
  }
}
