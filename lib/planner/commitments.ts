import type {
  CommitmentOccurrenceOverride,
  LocalDate,
  LocalTime,
  RecurringCommitmentInput,
} from './types';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^\d{2}:\d{2}$/;

export interface CommitmentOccurrence {
  id: string;
  commitmentId: string;
  sourceDate: LocalDate;
  date: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime;
}

function isLocalDate(value: string | null | undefined): value is LocalDate {
  return Boolean(value && LOCAL_DATE_PATTERN.test(value));
}

function isLocalTime(value: string | null | undefined): value is LocalTime {
  if (!value || !LOCAL_TIME_PATTERN.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function addDays(value: LocalDate, amount: number): LocalDate {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + amount));
  return result.toISOString().slice(0, 10);
}

function dayOfWeek(value: LocalDate): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function occursOnSourceDate(commitment: RecurringCommitmentInput, date: LocalDate): boolean {
  if (commitment.enabled === false) return false;
  if (!commitment.daysOfWeek.includes(dayOfWeek(date))) return false;
  if (commitment.startDate && date < commitment.startDate) return false;
  if (commitment.endDate && date > commitment.endDate) return false;
  return true;
}

/**
 * Expand a recurring commitment into visible occurrences. Override source dates
 * are considered even when they live outside the visible range, so dragging an
 * occurrence across a week boundary does not make it disappear.
 */
export function buildCommitmentOccurrences(
  commitment: RecurringCommitmentInput,
  startDate: LocalDate,
  endDate: LocalDate,
): CommitmentOccurrence[] {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || startDate > endDate) return [];
  if (!isLocalTime(commitment.startTime) || !isLocalTime(commitment.endTime)) return [];

  const candidateSourceDates = new Set<LocalDate>();
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    candidateSourceDates.add(date);
  }
  Object.keys(commitment.occurrenceOverrides || {}).forEach(date => {
    if (isLocalDate(date)) candidateSourceDates.add(date);
  });

  const results: CommitmentOccurrence[] = [];
  for (const sourceDate of candidateSourceDates) {
    if (!occursOnSourceDate(commitment, sourceDate)) continue;
    const override = commitment.occurrenceOverrides?.[sourceDate] || {};
    if (override.skipped) continue;
    const date = isLocalDate(override.scheduledDate) ? override.scheduledDate : sourceDate;
    if (date < startDate || date > endDate) continue;
    const startTime = isLocalTime(override.startTime) ? override.startTime : commitment.startTime;
    const endTime = isLocalTime(override.endTime) ? override.endTime : commitment.endTime;
    results.push({
      id: `commitment:${commitment.id}@${sourceDate}`,
      commitmentId: commitment.id,
      sourceDate,
      date,
      startTime,
      endTime,
    });
  }

  return results.sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.startTime.localeCompare(right.startTime)
    || left.id.localeCompare(right.id)
  );
}

export function withCommitmentOccurrenceOverride(
  commitment: RecurringCommitmentInput,
  sourceDate: LocalDate,
  override: CommitmentOccurrenceOverride,
): RecurringCommitmentInput {
  return {
    ...commitment,
    occurrenceOverrides: {
      ...(commitment.occurrenceOverrides || {}),
      [sourceDate]: {
        ...(commitment.occurrenceOverrides?.[sourceDate] || {}),
        ...override,
        updatedAt: new Date().toISOString(),
      },
    },
    updatedAt: new Date().toISOString(),
  };
}
