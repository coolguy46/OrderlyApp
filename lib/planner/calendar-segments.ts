export interface CalendarDaySegment {
  start: Date;
  end: Date;
  startsAtSource: boolean;
  endsAtSource: boolean;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function localDayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function nextLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1);
}

/**
 * Split a wall-clock interval into calendar-day pieces inside a visible range.
 * The week grid uses wall-clock carrier Dates, so this helper deliberately
 * preserves local calendar boundaries instead of assuming every day is 24h.
 */
export function splitCalendarIntervalByDay(
  sourceStart: Date,
  sourceEnd: Date,
  visibleStart: Date,
  visibleDayCount: number,
): CalendarDaySegment[] {
  if (!isValidDate(sourceStart) || !isValidDate(sourceEnd)
    || !isValidDate(visibleStart) || sourceEnd <= sourceStart
    || !Number.isInteger(visibleDayCount) || visibleDayCount <= 0) {
    return [];
  }

  const rangeStart = localDayStart(visibleStart);
  let rangeEnd = rangeStart;
  for (let index = 0; index < visibleDayCount; index += 1) {
    rangeEnd = nextLocalDay(rangeEnd);
  }

  let segmentStart = new Date(Math.max(sourceStart.getTime(), rangeStart.getTime()));
  const clippedEnd = new Date(Math.min(sourceEnd.getTime(), rangeEnd.getTime()));
  if (clippedEnd <= segmentStart) return [];

  const segments: CalendarDaySegment[] = [];
  while (segmentStart < clippedEnd) {
    const dayEnd = nextLocalDay(segmentStart);
    const segmentEnd = new Date(Math.min(dayEnd.getTime(), clippedEnd.getTime()));
    segments.push({
      start: new Date(segmentStart),
      end: segmentEnd,
      startsAtSource: segmentStart.getTime() === sourceStart.getTime(),
      endsAtSource: segmentEnd.getTime() === sourceEnd.getTime(),
    });
    segmentStart = segmentEnd;
  }

  return segments;
}
