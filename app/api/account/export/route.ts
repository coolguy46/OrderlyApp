import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AccountExportTooLargeError, readAccountExport } from '@/lib/account-export';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  try {
    // Use the verified session and its RLS permissions, never an administrator
    // client or a user ID supplied in the request.
    const client = await createSupabaseServerClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) {
      return Response.json({ error: 'Sign in again before exporting your data.' }, { status: 401, headers: privateHeaders });
    }
    const exported = await readAccountExport(client, user.id, signal);
    return Response.json(exported, {
      headers: {
        ...privateHeaders,
        'Content-Disposition': `attachment; filename="orderly-export-${exported.exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    return Response.json({
      error: error instanceof AccountExportTooLargeError ? error.message
        : signal.aborted ? 'The export took too long. No partial file was downloaded. Please try again.'
          : 'Your saved data could not be exported. No partial file was downloaded. Please try again.',
    }, { status: error instanceof AccountExportTooLargeError ? 413 : signal.aborted ? 504 : 503, headers: privateHeaders });
  }
}
