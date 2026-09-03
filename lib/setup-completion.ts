export const SETUP_COMPLETED_METADATA_KEY = 'orderly_setup_completed_at';
export const SETUP_COMPLETED_STORAGE_NAMESPACE = 'orderly-setup-complete';

export function hasCompletedSetupMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;

  const value = (metadata as Record<string, unknown>)[SETUP_COMPLETED_METADATA_KEY];
  if (value === true) return true;
  if (typeof value !== 'string' || value.trim() === '') return false;

  return Number.isFinite(Date.parse(value));
}

export function setupCompletionMetadataUpdate(now = new Date()): Record<string, string> {
  if (!Number.isFinite(now.getTime())) {
    throw new Error('A valid completion time is required.');
  }
  return { [SETUP_COMPLETED_METADATA_KEY]: now.toISOString() };
}
