const SOURCE_PREFIX = /\[(?:canvas|google\s+classroom|classroom)\]/gi;

/** Normalize task titles and schedule commands for deterministic matching. */
export function normalizeScheduleCommandWords(value: string): string {
  return value
    .toLowerCase()
    .replace(SOURCE_PREFIX, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an|my|task|assignment|event)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clockLabel(hour: string, minute: string | undefined): string {
  return `${hour}${minute ? `:${minute}` : ''}`;
}

function isValidClock(hourValue: string, minuteValue: string | undefined): boolean {
  const hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  return Number.isInteger(hour)
    && Number.isInteger(minute)
    && hour >= 0
    && hour <= 23
    && minute >= 0
    && minute <= 59;
}

function isExplicit24HourClock(hourValue: string, minuteValue: string | undefined): boolean {
  if (!isValidClock(hourValue, minuteValue)) return false;
  const hour = Number(hourValue);
  return hour === 0 || hour > 12 || hourValue.startsWith('0');
}

function isAmbiguousBareClock(
  hourValue: string,
  minuteValue: string | undefined,
  periodValue: string | undefined,
): boolean {
  if (periodValue || !isValidClock(hourValue, minuteValue)) return false;
  const hour = Number(hourValue);
  return hour >= 1 && hour <= 12 && !isExplicit24HourClock(hourValue, minuteValue);
}

export interface ScheduleClockRangeMatch {
  index: number;
  raw: string;
  startHour: string;
  startMinute: string | undefined;
  startPeriod: string | undefined;
  endHour: string;
  endMinute: string | undefined;
  endPeriod: string | undefined;
}

/** Ignore hyphenated numbers in task titles unless the range has time context. */
export function findScheduleClockRange(value: string): ScheduleClockRangeMatch | null {
  const pattern = /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const explicit24HourRange = Boolean(match[2] && match[6])
      && (isExplicit24HourClock(match[1], match[2]) || isExplicit24HourClock(match[5], match[6]));
    const hasTimeContext = /^from\s/i.test(match[0])
      || Boolean(match[3] || match[7])
      || /^(?:to|until)$/i.test(match[4])
      || explicit24HourRange;
    if (!hasTimeContext) continue;
    return {
      index: match.index,
      raw: match[0],
      startHour: match[1],
      startMinute: match[2],
      startPeriod: match[3],
      endHour: match[5],
      endMinute: match[6],
      endPeriod: match[7],
    };
  }
  return null;
}

/**
 * Find a clock expression that has two valid interpretations. Ranges inherit
 * an AM/PM suffix from either endpoint ("4 to 5 pm"), matching normal usage.
 * Values such as 00:30, 08:00, and 17:00 are explicit 24-hour times.
 */
export function findAmbiguousBareTime(value: string): string | null {
  const range = findScheduleClockRange(value);
  if (range) {
    const sharedPeriod = range.startPeriod || range.endPeriod;
    if (!sharedPeriod) {
      if (isAmbiguousBareClock(range.startHour, range.startMinute, undefined)) {
        return clockLabel(range.startHour, range.startMinute);
      }
      if (isAmbiguousBareClock(range.endHour, range.endMinute, undefined)) {
        return clockLabel(range.endHour, range.endMinute);
      }
    }
    return null;
  }

  const single = /\b(?:at|from|starting(?:\s+at)?|after|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(value)
    || /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(value);
  if (!single || !isAmbiguousBareClock(single[1], single[2], single[3])) return null;
  return clockLabel(single[1], single[2]);
}
