export interface PomodoroSettingsValue {
  focusDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsBeforeLongBreak: number;
}

export interface TimerPreset {
  id: string;
  name: string;
  focusHours: number;
  focusMinutes: number;
  focusSeconds: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
}

export interface TimerSettingsInput {
  focusHours: unknown;
  focusMinutes: unknown;
  focusSeconds: unknown;
  shortBreakMinutes: unknown;
  longBreakMinutes: unknown;
  sessionsBeforeLongBreak: unknown;
}

const MAX_FOCUS_MINUTES = 24 * 60;
const MAX_PRESETS = 50;

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function sanitizePomodoroSettings(value: Partial<PomodoroSettingsValue> | null | undefined): PomodoroSettingsValue {
  return {
    focusDuration: boundedInteger(value?.focusDuration, 25, 1, MAX_FOCUS_MINUTES),
    shortBreakDuration: boundedInteger(value?.shortBreakDuration, 5, 1, 30),
    longBreakDuration: boundedInteger(value?.longBreakDuration, 15, 1, 60),
    sessionsBeforeLongBreak: boundedInteger(value?.sessionsBeforeLongBreak, 4, 1, 10),
  };
}

export function normalizeTimerSettingsInput(input: TimerSettingsInput): {
  settings: PomodoroSettingsValue;
  presetFields: Omit<TimerPreset, 'id' | 'name'>;
} {
  const focusHours = boundedInteger(input.focusHours, 0, 0, 23);
  const focusMinutes = boundedInteger(input.focusMinutes, 0, 0, 59);
  const focusSeconds = boundedInteger(input.focusSeconds, 0, 0, 59);
  const shortBreakMinutes = boundedInteger(input.shortBreakMinutes, 5, 1, 30);
  const longBreakMinutes = boundedInteger(input.longBreakMinutes, 15, 1, 60);
  const sessionsBeforeLongBreak = boundedInteger(input.sessionsBeforeLongBreak, 4, 1, 10);
  const focusDuration = Math.min(
    MAX_FOCUS_MINUTES,
    Math.max(1, focusHours * 60 + focusMinutes + Math.ceil(focusSeconds / 60)),
  );

  return {
    settings: {
      focusDuration,
      shortBreakDuration: shortBreakMinutes,
      longBreakDuration: longBreakMinutes,
      sessionsBeforeLongBreak,
    },
    presetFields: {
      focusHours,
      focusMinutes,
      focusSeconds,
      shortBreakMinutes,
      longBreakMinutes,
      sessionsBeforeLongBreak,
    },
  };
}

function parsePreset(value: unknown): TimerPreset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 200) return null;
  if (typeof candidate.name !== 'string') return null;
  const name = candidate.name.trim().slice(0, 80);
  if (!name) return null;

  const { presetFields } = normalizeTimerSettingsInput(candidate as unknown as TimerSettingsInput);
  return { id: candidate.id, name, ...presetFields };
}

export function parseTimerPresets(value: unknown): TimerPreset[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PRESETS)
    .map(parsePreset)
    .filter((preset): preset is TimerPreset => preset !== null);
}
