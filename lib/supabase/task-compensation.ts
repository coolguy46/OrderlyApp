export interface TaskCompensationConfig {
  supabaseUrl: string;
  publishableKey: string;
  taskId: string;
  ownerUserId: string;
  accessToken: string;
}

/**
 * Deletes exactly one task with the session that originally created it. A
 * successful PostgREST response also counts when the row is already absent:
 * compensation is intentionally idempotent, and its goal is that no matching
 * row remains after the request.
 */
export async function deleteOwnedTaskWithToken(
  config: TaskCompensationConfig,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (
    !config.supabaseUrl
    || !config.publishableKey
    || !config.taskId
    || !config.ownerUserId
    || !config.accessToken
  ) return false;

  const params = new URLSearchParams({
    id: `eq.${config.taskId}`,
    user_id: `eq.${config.ownerUserId}`,
    select: 'id',
  });
  try {
    const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
    const response = await fetcher(`${baseUrl}/rest/v1/tasks?${params.toString()}`, {
      method: 'DELETE',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.accessToken}`,
        Prefer: 'return=representation',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
