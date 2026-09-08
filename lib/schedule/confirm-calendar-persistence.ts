/** Keep optimistic changes, but never describe an unconfirmed write as saved. */
export async function confirmCalendarPersistence(
  waitForPersistence: () => Promise<boolean>,
  isCurrentAccount: () => boolean,
): Promise<'saved' | 'pending' | 'stale'> {
  let saved = false;
  try {
    saved = await waitForPersistence();
  } catch {
    // The durable outbox retains the retry. Do not leak provider errors or
    // discard a newer optimistic change by rolling back an old snapshot.
  }
  if (!isCurrentAccount()) return 'stale';
  return saved ? 'saved' : 'pending';
}
