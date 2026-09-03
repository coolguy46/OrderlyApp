const BLOCK_TAGS = /<\/?(?:address|article|aside|blockquote|div|dl|dt|dd|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const BREAK_TAGS = /<br\s*\/?>/gi;
const NON_CONTENT_ELEMENTS = /<(script|style|svg|math|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const REMAINING_TAGS = /<[^>]*>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/**
 * Convert untrusted LMS HTML to plain text. The return value must only ever be
 * rendered as a React text child; it is deliberately not an HTML sanitizer.
 */
export function externalHtmlToPlainText(value: string | null | undefined): string {
  if (!value) return '';

  const text = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(NON_CONTENT_ELEMENTS, '')
    .replace(BREAK_TAGS, '\n')
    .replace(BLOCK_TAGS, '\n')
    .replace(REMAINING_TAGS, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
      if (key[0] === '#') {
        const hexadecimal = key[1]?.toLowerCase() === 'x';
        const digits = key.slice(hexadecimal ? 2 : 1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
          try {
            return String.fromCodePoint(codePoint);
          } catch {
            return entity;
          }
        }
        return entity;
      }

      return NAMED_ENTITIES[key.toLowerCase()] ?? entity;
    });

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
