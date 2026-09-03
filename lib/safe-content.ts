const BLOCK_TAG_NAMES = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const DISCARD_CONTENT_TAG_NAMES = new Set([
  'script', 'style', 'svg', 'math', 'iframe', 'object', 'template',
]);

const VOID_TAG_NAMES = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

// A lone formatting tag can be literal instructional text (for example,
// "Type <strong> exactly"). Only treat these as markup when paired, carrying
// attributes, or found inside a larger fragment that is already clearly HTML.
const AMBIGUOUS_LITERAL_TAG_NAMES = new Set([
  'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'del', 'dfn', 'em', 'font',
  'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

interface CommentToken {
  kind: 'comment';
  end: number;
}

interface DeclarationToken {
  kind: 'declaration';
  end: number;
}

interface TagToken {
  kind: 'tag';
  start: number;
  end: number;
  name: string;
  attributes: string;
  closing: boolean;
  selfClosing: boolean;
  terminated: boolean;
}

type MarkupToken = CommentToken | DeclarationToken | TagToken;

function scanToTagEnd(value: string, start: number): { end: number; terminated: boolean } {
  let quote: '"' | "'" | null = null;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return { end: index + 1, terminated: true };
    }
  }

  return { end: value.length, terminated: false };
}

function readMarkupToken(value: string, start: number): MarkupToken | null {
  if (value[start] !== '<') return null;

  if (value.startsWith('<!--', start)) {
    const closeIndex = value.indexOf('-->', start + 4);
    return {
      kind: 'comment',
      end: closeIndex === -1 ? value.length : closeIndex + 3,
    };
  }

  const marker = value[start + 1];
  if (marker === '!' || marker === '?') {
    const boundary = scanToTagEnd(value, start + 2);
    return { kind: 'declaration', end: boundary.end };
  }

  let cursor = start + 1;
  let closing = false;
  if (value[cursor] === '/') {
    closing = true;
    cursor += 1;
  }

  if (!/[a-z]/i.test(value[cursor] || '')) return null;
  const nameStart = cursor;
  while (/[a-z0-9:-]/i.test(value[cursor] || '')) cursor += 1;
  const name = value.slice(nameStart, cursor).toLowerCase();
  const boundary = scanToTagEnd(value, cursor);
  const attributeEnd = boundary.terminated ? boundary.end - 1 : boundary.end;
  const attributes = value.slice(cursor, attributeEnd);

  return {
    kind: 'tag',
    start,
    end: boundary.end,
    name,
    attributes,
    closing,
    selfClosing: !closing && /\/\s*$/.test(attributes),
    terminated: boundary.terminated,
  };
}

function hasAttributes(token: TagToken): boolean {
  return token.attributes.replace(/\/\s*$/, '').trim().length > 0;
}

function isEmbeddedLiteralCandidate(value: string, token: TagToken): boolean {
  if (
    token.closing
    || token.selfClosing
    || !/[a-z0-9]/i.test(value[token.start - 1] || '')
    || BLOCK_TAG_NAMES.has(token.name)
    || VOID_TAG_NAMES.has(token.name)
    || DISCARD_CONTENT_TAG_NAMES.has(token.name)
    || /[='"]/.test(token.attributes)
  ) {
    return false;
  }

  return findClosingTag(value, token.end, token.name) === null;
}

function hasUnambiguousMarkup(value: string): boolean {
  const openFormattingTags = new Map<string, number>();
  const closeFormattingTags = new Map<string, number>();

  for (let index = 0; index < value.length;) {
    const token = readMarkupToken(value, index);
    if (!token) {
      index += 1;
      continue;
    }

    if (token.kind !== 'tag') return true;
    if (isEmbeddedLiteralCandidate(value, token)) {
      index = token.end;
      continue;
    }
    if (
      DISCARD_CONTENT_TAG_NAMES.has(token.name)
      || BLOCK_TAG_NAMES.has(token.name)
      || VOID_TAG_NAMES.has(token.name)
      || token.name === 'a'
      || !AMBIGUOUS_LITERAL_TAG_NAMES.has(token.name)
      || hasAttributes(token)
      || token.selfClosing
      || !token.terminated
    ) {
      return true;
    }

    const counts = token.closing ? closeFormattingTags : openFormattingTags;
    counts.set(token.name, (counts.get(token.name) || 0) + 1);
    index = token.end;
  }

  return [...openFormattingTags].some(([name, count]) => (
    count > 0 && (closeFormattingTags.get(name) || 0) > 0
  ));
}

function decodeHtmlEntities(value: string, decodeAngles = true): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] === '#') {
      const hexadecimal = key[1]?.toLowerCase() === 'x';
      const digits = key.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!decodeAngles && (codePoint === 60 || codePoint === 62)) return entity;
      if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return entity;
    }

    const normalizedKey = key.toLowerCase();
    if (!decodeAngles && (normalizedKey === 'lt' || normalizedKey === 'gt')) return entity;
    return NAMED_ENTITIES[normalizedKey] ?? entity;
  });
}

function decodeTextEntities(value: string): string {
  const fullyDecoded = decodeHtmlEntities(value);
  return hasUnambiguousMarkup(fullyDecoded)
    ? decodeHtmlEntities(value, false)
    : fullyDecoded;
}

function findClosingTag(
  value: string,
  start: number,
  name: string,
): { start: number; end: number } | null {
  let depth = 1;

  for (let index = start; index < value.length;) {
    const token = readMarkupToken(value, index);
    if (!token) {
      index += 1;
      continue;
    }
    index = token.end;
    if (token.kind !== 'tag' || token.name !== name) continue;
    if (token.closing) {
      depth -= 1;
      if (depth === 0) return { start: token.start, end: token.end };
    } else if (!token.selfClosing) {
      depth += 1;
    }
  }

  return null;
}

function readAttributeValue(attributes: string, requestedName: string): string | null {
  for (let index = 0; index < attributes.length;) {
    while (/\s/.test(attributes[index] || '')) index += 1;
    if (attributes[index] === '/') {
      index += 1;
      continue;
    }

    const nameStart = index;
    while (/[^\s=/>]/.test(attributes[index] || '')) index += 1;
    const name = attributes.slice(nameStart, index).toLowerCase();
    if (!name) {
      index += 1;
      continue;
    }

    while (/\s/.test(attributes[index] || '')) index += 1;
    if (attributes[index] !== '=') continue;
    index += 1;
    while (/\s/.test(attributes[index] || '')) index += 1;

    const quote = attributes[index] === '"' || attributes[index] === "'"
      ? attributes[index]
      : null;
    if (quote) index += 1;
    const valueStart = index;
    if (quote) {
      while (index < attributes.length && attributes[index] !== quote) index += 1;
    } else {
      while (/[^\s>]/.test(attributes[index] || '')) index += 1;
    }
    const value = attributes.slice(valueStart, index);
    if (quote && attributes[index] === quote) index += 1;
    if (name === requestedName) return value;
  }

  return null;
}

function readableAnchor(attributes: string, entityEncodedContents: string): string {
  const label = normalizeWhitespace(entityEncodedContents);
  const rawHref = readAttributeValue(attributes, 'href');
  const href = safeExternalUrl(rawHref ? decodeHtmlEntities(rawHref) : null);

  if (!href) return label;
  if (!label || safeExternalUrl(decodeTextEntities(label)) === href) return label || href;
  return `${label} (${href})`;
}

function htmlMarkupToEntityText(value: string): string {
  let text = '';

  for (let index = 0; index < value.length;) {
    const token = readMarkupToken(value, index);
    if (!token) {
      text += value[index];
      index += 1;
      continue;
    }

    index = token.end;
    if (token.kind !== 'tag') continue;

    if (isEmbeddedLiteralCandidate(value, token)) {
      text += value.slice(token.start, token.end);
      continue;
    }

    if (token.closing) {
      if (BLOCK_TAG_NAMES.has(token.name)) text += '\n';
      continue;
    }

    if (DISCARD_CONTENT_TAG_NAMES.has(token.name)) {
      if (token.selfClosing) continue;
      const closingTag = findClosingTag(value, token.end, token.name);
      index = closingTag?.end ?? value.length;
      continue;
    }

    if (token.name === 'a') {
      if (token.selfClosing) {
        text += readableAnchor(token.attributes, '');
        continue;
      }
      const closingTag = findClosingTag(value, token.end, token.name);
      const contentEnd = closingTag?.start ?? value.length;
      const contents = htmlMarkupToEntityText(value.slice(token.end, contentEnd));
      text += readableAnchor(token.attributes, contents);
      index = closingTag?.end ?? value.length;
      continue;
    }

    if (token.name === 'br' || BLOCK_TAG_NAMES.has(token.name)) text += '\n';
  }

  return text;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert untrusted LMS HTML to plain text. The return value must only ever be
 * rendered as a React text child; it is deliberately not an HTML sanitizer.
 * Repeated calls are safe because already-plain output is left unchanged.
 */
export function externalHtmlToPlainText(value: string | null | undefined): string {
  if (!value) return '';
  if (!hasUnambiguousMarkup(value)) return normalizeWhitespace(value);
  return normalizeWhitespace(decodeTextEntities(htmlMarkupToEntityText(value)));
}

/** Only HTTP(S) links from external task providers may be opened. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}
