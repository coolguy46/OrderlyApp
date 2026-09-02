import { emptySlotStartMinute } from '../planner/week-time-grid-slot.ts';

export const DASHBOARD_SCHEDULE_HOUR_HEIGHT = 54;
export const DASHBOARD_SCHEDULE_SLOT_DURATION_SECONDS = 30 * 60;

export interface DashboardScheduleCreationSlot {
  date: string;
  startTime: string;
  durationSeconds: number;
}

/** Convert a pointer position in the one-day dashboard grid to a local 15-minute slot. */
export function dashboardScheduleCreationSlot(
  date: string,
  clientY: number,
  columnTop: number,
): DashboardScheduleCreationSlot {
  const minute = emptySlotStartMinute(
    (clientY - columnTop) * (60 / DASHBOARD_SCHEDULE_HOUR_HEIGHT),
    0,
  );
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return {
    date,
    startTime: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    durationSeconds: DASHBOARD_SCHEDULE_SLOT_DURATION_SECONDS,
  };
}
