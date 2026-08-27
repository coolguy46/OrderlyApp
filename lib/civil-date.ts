import type { LocalDate } from './schedule/types.ts';
import {
  isLocalDate,
  localDateFromIso,
  localDateTimeToIso,
} from './schedule/selectors.ts';

/**
 * Read a date-only field from either a literal YYYY-MM-DD value or a stored
 * instant. Instants are rendered in the requested timezone; UTC slicing would
 * move dates backward for users east of Greenwich.
 */
export function civilDateFromStored(
  value: string | null | undefined,
  timeZone?: string,
): LocalDate | null {
  if (!value) return null;
  if (isLocalDate(value)) return value;
  return localDateFromIso(value, timeZone);
}

/** Store a date-only field as local midnight in the requested timezone. */
export function civilDateToIso(value: string, timeZone?: string): string | null {
  if (!isLocalDate(value)) return null;
  return localDateTimeToIso(value, '00:00:00', timeZone);
}

/** Calendar-day distance from `now` in the requested timezone. */
export function civilDateDayDistance(
  value: string | null | undefined,
  now: Date | number = Date.now(),
  timeZone?: string,
): number | null {
  const targetDate = civilDateFromStored(value, timeZone);
  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const currentDate = localDateFromIso(nowDate.toISOString(), timeZone);
  if (!targetDate || !currentDate) return null;

  const [targetYear, targetMonth, targetDay] = targetDate.split('-').map(Number);
  const [currentYear, currentMonth, currentDay] = currentDate.split('-').map(Number);
  return Math.round(
    (Date.UTC(targetYear, targetMonth - 1, targetDay)
      - Date.UTC(currentYear, currentMonth - 1, currentDay))
      / 86_400_000,
  );
}

/**
 * Format a stored civil date without letting the browser timezone reinterpret
 * the already-resolved calendar day. The requested timezone is used only to
 * derive the civil key from an instant; the key itself is rendered in UTC.
 */
export function formatCivilDate(
  value: string | null | undefined,
  timeZone?: string,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  },
  locale = 'en-US',
): string | null {
  const date = civilDateFromStored(value, timeZone);
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  const carrier = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(carrier);
}
