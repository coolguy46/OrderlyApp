import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { guardMutationRequest, readJsonBody, requestBodyErrorResponse } from '../lib/security/request.ts';
import { safeErrorCode } from '../lib/security/log.ts';

const endpoint = 'https://www.orderly.example/api/planner/conversation';
function request(headers = {}, body = '{}') {
  return new Request(endpoint, { method: 'POST', headers, body });
}
test('cookie mutations accept only the same origin, not sibling sites or forged origins', () => {
  for (const headers of [
    { cookie: 'session=test', origin: 'https://www.orderly.example' },
    { cookie: 'session=test', 'sec-fetch-site': 'same-origin' },
    {}, // Non-cookie clients still need route-level authentication.
  ]) assert.equal(guardMutationRequest(request(headers)), null);
  for (const headers of [
    { cookie: 'session=test' },
    { origin: 'https://attacker.example' },
    { origin: 'https://sibling.orderly.example', 'sec-fetch-site': 'same-site' },
    { origin: 'null' },
    { origin: 'https://www.orderly.example/path' },
    { origin: 'https://www.orderly.example', 'sec-fetch-site': 'cross-site' },
  ]) assert.equal(guardMutationRequest(request(headers)).status, 403);
});
test('JSON body parsing rejects form/text CSRF and malformed or oversized input', async () => {
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    await assert.rejects(readJsonBody(request({ 'content-type': contentType })), { status: 415 });
  }
  assert.deepEqual(await readJsonBody(request({ 'content-type': 'application/json; charset=utf-8' }, '{"text":"é"}')), { text: 'é' });
  await assert.rejects(readJsonBody(request({ 'content-type': 'application/json' }, '{')), { status: 400 });
  await assert.rejects(readJsonBody(request({ 'content-type': 'application/json', 'content-length': '9000' }), 8), { status: 413 });
  await assert.rejects(readJsonBody(request({ 'content-type': 'application/json' }, '"éééé"'), 8), { status: 413 });
});
test('streamed cap ignores a forged small Content-Length and cancels the unread body', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(64))); },
    cancel() { cancelled = true; },
  });
  const input = new Request(endpoint, {
    method: 'POST', duplex: 'half', body: stream,
    headers: { 'content-type': 'application/json', 'content-length': '2' },
  });
  try { await readJsonBody(input, 16); assert.fail('oversized request accepted'); }
  catch (error) {
    const response = requestBodyErrorResponse(error);
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(cancelled, true);
});
test('log metadata never retains arbitrary error messages, details, names or codes', () => {
  const secret = 'private-feed-or-token';
  assert.equal(safeErrorCode({ message: secret, details: secret, code: '23503' }), '23503');
  assert.equal(safeErrorCode({ message: secret, name: secret, code: secret }), 'unknown');
  assert.equal(safeErrorCode({ status: 502, message: secret }), 'http-502');
  assert.equal(safeErrorCode(new TypeError(secret)), 'TypeError');
});
test('sensitive cookie mutation routes invoke the shared origin guard', async () => {
  for (const route of ['account', 'auth/password-recovery', 'canvas/sync', 'canvas/validate', 'planner/conversation', 'planner/chat', 'planner/command']) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), 'utf8');
    assert.match(source, /guardMutationRequest\(request\)/, route);
  }
});
