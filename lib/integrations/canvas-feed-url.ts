const CANVAS_FEED_PATH = /^\/feeds\/calendars\/[^/]+\/?$/i;
const MAX_CANVAS_FEED_URL_LENGTH = 2_048;

export class CanvasFeedUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasFeedUrlValidationError';
  }
}

/**
 * Validate the non-network parts of a private Canvas calendar URL.
 *
 * Network-address and response validation still happens in the server-only
 * Canvas feed loader. Keeping the deterministic checks here lets forms reject
 * malformed input before any account setting is written.
 */
export function normalizeCanvasFeedUrl(rawUrl: string): string {
  const candidate = rawUrl.trim();
  if (!candidate || candidate.length > MAX_CANVAS_FEED_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new CanvasFeedUrlValidationError('Enter a valid Canvas calendar feed URL.');
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new CanvasFeedUrlValidationError('Enter a valid Canvas calendar feed URL.');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new CanvasFeedUrlValidationError('Canvas calendar feeds must use a standard HTTPS URL.');
  }

  if (!CANVAS_FEED_PATH.test(url.pathname)) {
    throw new CanvasFeedUrlValidationError('Use the Calendar Feed URL provided by Canvas.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (hostname !== 'instructure.com' && !hostname.endsWith('.instructure.com')) {
    throw new CanvasFeedUrlValidationError('Canvas calendar feeds must use an instructure.com address.');
  }

  url.hostname = hostname;
  url.hash = '';
  return url.toString();
}

export function canvasFeedUrlValidationMessage(rawUrl: string): string | null {
  try {
    normalizeCanvasFeedUrl(rawUrl);
    return null;
  } catch (error) {
    return error instanceof CanvasFeedUrlValidationError
      ? error.message
      : 'Enter a valid Canvas calendar feed URL.';
  }
}
