import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createCanvasFeedLoader, isPublicCanvasAddress } from '../lib/integrations/canvas-feed-fetch.ts';
import { normalizeCanvasFeedUrl } from '../lib/integrations/canvas-feed-url.ts';

const feed = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const url = 'https://canvas.school.edu/feeds/calendars/fixture-secret.ics';
const publicAddresses = [{ address: '93.184.216.34', family: 4 }];

function transport(responses = [{ body: feed }]) {
  const calls = [];
  const streams = [];
  const request = (target, options, callback) => {
    calls.push({ target: new URL(target), options });
    const req = new EventEmitter();
    req.end = () => {
      const spec = responses.shift();
      if (!spec) throw new Error('Unexpected extra network request');
      if (spec.error) return queueMicrotask(() => req.emit('error', spec.error));
      const response = spec.stream ?? Readable.from(spec.chunks ?? [Buffer.from(spec.body ?? feed)]);
      response.statusCode = spec.status ?? 200;
      response.headers = spec.headers ?? {};
      streams.push(response);
      options.signal.addEventListener('abort', () => response.destroy(new Error('Aborted')), { once: true });
      queueMicrotask(() => callback(response));
    };
    return req;
  };
  return { request, calls, streams };
}

test('accepts public Canvas custom-school URLs without weakening scheme/path validation', () => {
  assert.equal(normalizeCanvasFeedUrl(url), url);
  assert.equal(normalizeCanvasFeedUrl('https://school.instructure.com/feeds/calendars/example.ics'), 'https://school.instructure.com/feeds/calendars/example.ics');
  for (const host of ['127.0.0.1', '[::1]', 'localhost', 'canvas.local', 'metadata.google.internal', 'router.home.arpa']) {
    assert.throws(() => normalizeCanvasFeedUrl(`https://${host}/feeds/calendars/secret.ics`));
  }
  for (const candidate of [url.replace('https:', 'http:'), url.replace('/feeds/calendars/', '/other/'), url.replace('canvas.', 'user:secret@canvas.')]) {
    assert.throws(() => normalizeCanvasFeedUrl(candidate));
  }
});

test('rejects private, mapped, metadata, documentation and transition network addresses', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '192.0.0.8', '192.0.2.1', '192.88.99.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '64:ff9b::a00:1', 'fc00::1', 'fe80::1', 'fec0::1', 'ff02::1',
    '2001:db8::1', '2002:7f00:1::1', '3fff::1', 'not-an-ip',
  ]) assert.equal(isPublicCanvasAddress(address), false, address);
  for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicCanvasAddress(address), true, address);
  }
});

test('pins the validated DNS address while preserving TLS hostname and no credentials', async () => {
  const stub = transport();
  let dnsCalls = 0;
  const load = createCanvasFeedLoader({
    request: stub.request,
    resolve: async () => ++dnsCalls === 1 ? publicAddresses : [{ address: '127.0.0.1', family: 4 }],
  });
  assert.equal(await load(url), feed);
  assert.equal(dnsCalls, 1);
  const { target, options } = stub.calls[0];
  assert.equal(target.hostname, 'canvas.school.edu');
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false);
  assert.equal(options.family, 4);
  options.lookup(target.hostname, {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, publicAddresses[0].address);
    assert.equal(family, 4);
  });
  assert.equal(dnsCalls, 1, 'socket DNS lookup must not resolve attacker-controlled DNS a second time');
  assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding']);
});

test('rejects every mixed public/private DNS answer before any connection', async () => {
  for (const addresses of [[], [...publicAddresses, { address: '::1', family: 6 }], [{ address: '127.0.0.1', family: 4 }]]) {
    const stub = transport();
    await assert.rejects(createCanvasFeedLoader({ request: stub.request, resolve: async () => addresses })(url));
    assert.equal(stub.calls.length, 0);
  }
});

test('validates and independently pins legitimate redirects without leaking a Referer', async () => {
  const stub = transport([
    { status: 302, headers: { location: 'https://school.instructure.com/feeds/calendars/new-secret.ics' } },
    { body: feed },
  ]);
  const resolvedHosts = [];
  const load = createCanvasFeedLoader({ request: stub.request, resolve: async hostname => {
    resolvedHosts.push(hostname);
    return publicAddresses;
  } });
  assert.equal(await load(url), feed);
  assert.deepEqual(resolvedHosts, ['canvas.school.edu', 'school.instructure.com']);
  assert.equal(stub.streams.every(stream => stream.destroyed), true);
  assert.equal(stub.calls[1].options.headers.Referer, undefined);
});

test('rejects unsafe redirects, including a public-looking host resolving privately', async () => {
  for (const location of [
    'http://school.instructure.com/feeds/calendars/secret.ics',
    'https://127.0.0.1/feeds/calendars/secret.ics',
    'https://canvas.school.edu/admin',
    'https://internal.school.edu/feeds/calendars/secret.ics',
    'https://user:password@canvas.school.edu/feeds/calendars/secret.ics',
  ]) {
    const stub = transport([{ status: 302, headers: { location } }]);
    const load = createCanvasFeedLoader({ request: stub.request, resolve: async hostname => (
      hostname === 'internal.school.edu' ? [{ address: '10.0.0.1', family: 4 }] : publicAddresses
    ) });
    await assert.rejects(load(url));
    assert.equal(stub.calls.length, 1, location);
    assert.equal(stub.streams[0].destroyed, true);
  }
});

test('caps redirects and closes each rejected response', async () => {
  const stub = transport(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: url } })));
  await assert.rejects(createCanvasFeedLoader({ request: stub.request, resolve: async () => publicAddresses })(url));
  assert.equal(stub.calls.length, 4);
  assert.ok(stub.streams.every(stream => stream.destroyed));
});

test('caps both declared and streamed bytes and rejects unexpected encodings/documents', async () => {
  for (const response of [
    { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } },
    { chunks: [Buffer.alloc(5 * 1024 * 1024), Buffer.from('overflow')] },
    { headers: { 'content-encoding': 'gzip' } },
    { body: '<html>Login</html>' },
    { status: 500 },
  ]) {
    const stub = transport([response]);
    await assert.rejects(createCanvasFeedLoader({ request: stub.request, resolve: async () => publicAddresses })(url));
    assert.equal(stub.streams[0].destroyed, true);
  }
});

test('deadline includes DNS and stalled response body, and errors never contain feed secrets', async () => {
  const neverResolving = createCanvasFeedLoader({ resolve: () => new Promise(() => {}), timeoutMs: 15 });
  await assert.rejects(neverResolving(url), /timed out/);
  const stalled = new Readable({ read() {} });
  const stub = transport([{ stream: stalled }]);
  await assert.rejects(createCanvasFeedLoader({ request: stub.request, resolve: async () => publicAddresses, timeoutMs: 15 })(url), /timed out/);
  assert.equal(stalled.destroyed, true);
  const failing = transport([{ error: new Error(`Connection to ${url} failed`) }]);
  await assert.rejects(createCanvasFeedLoader({ request: failing.request, resolve: async () => publicAddresses })(url), error => {
    assert.doesNotMatch(error.message, /fixture-secret|school.edu/);
    return true;
  });
});

test('failed feeds retain only a fixed operational category, never provider text or a URL', async () => {
  for (const [response,diagnostic] of [
    [{status:403},'feed-http-403'],
    [{headers:{'content-encoding':'gzip'}},'feed-encoding'],
    [{body:'<html>private provider reply</html>'},'feed-document'],
    [{error:new Error(`Secret ${url}`)},'feed-connect'],
  ]) {
    const stub=transport([response]);
    await assert.rejects(createCanvasFeedLoader({request:stub.request,resolve:async()=>publicAddresses})(url),error=>{
      assert.equal(error.diagnostic,diagnostic);
      assert.doesNotMatch(JSON.stringify(error),/fixture-secret|school.edu|private provider reply/);
      return true;
    });
  }
});
