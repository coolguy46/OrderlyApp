/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic database transport for the real service and hook. */
export const controls = { mode: 'success', reads: 0, aborts: 0, signalledReads: 0, rowExists: true };
const rows: Record<string, any> = {};
export const supabase = {
  from(table: string) {
    if (table !== 'canvas_settings') throw new Error(`Unexpected fixture table ${table}`);
    let owner = '', signal: AbortSignal | undefined, patch: any;
    return {
      select() { return this; },
      eq(key: string, value: string) { if (key === 'user_id') owner = value; return this; },
      update(value: any) { patch = value; return this; },
      abortSignal(value: AbortSignal) { signal = value; controls.signalledReads++; return this; },
      async maybeSingle() {
        controls.reads++;
        if (controls.mode === 'hang') return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { controls.aborts++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        });
        if (controls.mode === 'error') return { data: null, error: { code: 'FETCH_ERROR', message: 'Synthetic database failure' } };
        if (!controls.rowExists) return { data: null, error: null };
        rows[owner] ||= { user_id: owner, ical_url: `https://example.invalid/${owner}.ics`, last_sync_at: null, last_background_sync_at: null,
          sync_enabled: true, auto_sync_interval: 15, sync_interval_migrated: true, time_zone: 'UTC' };
        Object.assign(rows[owner], patch);
        return { data: { ...rows[owner] }, error: null };
      },
    };
  },
};
export const isSupabaseAvailable = () => true;
export const requireSupabaseAvailable = () => {};
export const supabasePublishableKey = 'synthetic-public-key';
export const supabaseUrl = 'https://example.invalid';
export const clearSupabaseBrowserAuthStorage = () => {};
