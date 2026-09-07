// Node-only transport, imported by the server-only Canvas sync service.
import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { normalizeCanvasFeedUrl } from './canvas-feed-url.ts';

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv4');
// Only global-unicast IPv6 is eligible. Exclude protocol-assignment,
// documentation and transition ranges (which can embed private IPv4).
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv6');

export function isPublicCanvasAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  return family === 6
    && globalIpv6.check(address, 'ipv6')
    && !blockedAddresses.check(address, 'ipv6');
}

type ResolvedAddress = { address: string; family: number };
interface FeedDependencies {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: typeof httpsRequest;
  timeoutMs?: number;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Canvas feed request timed out'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('Canvas feed request timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Exposed for isolated transport tests; production callers use fetchCanvasFeed. */
export function createCanvasFeedLoader(dependencies: FeedDependencies = {}) {
  const resolve = dependencies.resolve ?? (hostname => lookup(hostname, { all: true, verbatim: true }));
  const request = dependencies.request ?? httpsRequest;

  return async function loadCanvasFeed(rawUrl: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? FETCH_TIMEOUT_MS);
    let activeResponse: IncomingMessage | undefined;

    try {
      let currentUrl = new URL(normalizeCanvasFeedUrl(rawUrl));
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const addresses = await abortable(resolve(currentUrl.hostname), controller.signal);
        if (!addresses.length || addresses.some(({ address, family }) => (
          !isPublicCanvasAddress(address) || isIP(address) !== family
        ))) throw new Error('Canvas feed hostname must resolve only to public addresses');

        // Pin the validated address at socket creation. A separate DNS preflight
        // followed by fetch() is vulnerable to DNS rebinding. Preserve the URL
        // hostname for TLS certificate verification, SNI and the HTTP Host.
        const address = addresses.find(value => value.family === 4) ?? addresses[0];
        const options: RequestOptions = {
          method: 'GET',
          agent: false,
          family: address.family,
          lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
          signal: controller.signal,
          rejectUnauthorized: true,
          maxHeaderSize: 16 * 1024,
          headers: {
            Accept: 'text/calendar, text/plain;q=0.9',
            // Do not accept compressed streams that could evade the byte cap.
            'Accept-Encoding': 'identity',
          },
        };
        activeResponse = await abortable(new Promise<IncomingMessage>((resolveResponse, reject) => {
          const req = request(currentUrl, options, resolveResponse);
          req.once('error', reject);
          req.end();
        }), controller.signal);
        const response = activeResponse;
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (redirects === MAX_REDIRECTS || !location) throw new Error('Canvas feed returned an invalid redirect');
          // Every hop must be HTTPS, match Canvas's feed path and resolve to a
          // newly pinned public address. No cookies, credentials or Referer pass.
          currentUrl = new URL(normalizeCanvasFeedUrl(new URL(location, currentUrl).toString()));
          continue;
        }
        if (status < 200 || status >= 300) throw new Error(`Canvas feed returned status ${status}`);
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          throw new Error('Canvas feed returned an unsupported encoding');
        }
        const declaredLength = Number(response.headers['content-length']);
        if (declaredLength > MAX_FEED_BYTES) throw new Error('Canvas feed exceeds the 5 MB limit');
        let byteCount = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of response) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteCount += buffer.length;
          if (byteCount > MAX_FEED_BYTES) throw new Error('Canvas feed exceeds the 5 MB limit');
          chunks.push(buffer);
        }
        const content = Buffer.concat(chunks).toString('utf8');
        if (!/^BEGIN:VCALENDAR\s*$/mi.test(content) || !/^END:VCALENDAR\s*$/mi.test(content)) {
          throw new Error('Canvas feed did not return an iCalendar document');
        }
        return content;
      }
      throw new Error('Canvas feed could not be fetched');
    } catch {
      // Native request errors may contain a private URL or response metadata.
      throw new Error(controller.signal.aborted
        ? 'Canvas feed request timed out'
        : 'Canvas feed could not be read securely');
    } finally {
      activeResponse?.destroy();
      controller.abort();
      clearTimeout(timeout);
    }
  };
}

export const fetchCanvasFeed = createCanvasFeedLoader();
