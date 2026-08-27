import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANVAS_MANUAL_SYNC_CLIENT_DEADLINE_MS,
  CANVAS_MANUAL_SYNC_SERVER_DEADLINE_MS,
  CanvasOperationTimeoutError,
  readCanvasSyncResponse,
  withCanvasDeadline,
} from '../lib/integrations/canvas-sync-reliability.ts';

test('the client deadline leaves time for the server to return its timeout response', () => {
  assert.ok(CANVAS_MANUAL_SYNC_CLIENT_DEADLINE_MS > CANVAS_MANUAL_SYNC_SERVER_DEADLINE_MS);
});

test('a deadline rejects hanging work and aborts its signal', async () => {
  let signalWasAborted = false;

  await assert.rejects(
    withCanvasDeadline(
      signal => new Promise(() => {
        signal.addEventListener('abort', () => {
          signalWasAborted = true;
        }, { once: true });
      }),
      5,
      'Timed out for the test'
    ),
    error => error instanceof CanvasOperationTimeoutError
      && error.message === 'Timed out for the test'
  );

  assert.equal(signalWasAborted, true);
});

test('HTML hosting errors become an actionable message instead of a JSON parse error', async () => {
  const response = new Response('<!doctype html><title>Gateway Timeout</title>', {
    status: 504,
  });

  await assert.rejects(
    readCanvasSyncResponse(response),
    /Canvas sync took too long.*try again/i
  );
});

test('a JSON server error is preserved for the user', async () => {
  const response = Response.json(
    { error: 'Connect a Canvas calendar before syncing' },
    { status: 400 }
  );

  await assert.rejects(
    readCanvasSyncResponse(response),
    /Connect a Canvas calendar before syncing/
  );
});

test('successful sync responses require an assignments array', async () => {
  await assert.rejects(
    readCanvasSyncResponse(Response.json({ success: true })),
    /incomplete response/i
  );

  const parsed = await readCanvasSyncResponse(Response.json({ assignments: [], imported: 0 }));
  assert.deepEqual(parsed.assignments, []);
});
