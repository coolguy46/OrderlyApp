import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTimerSettingsInput,
  parseTimerPresets,
  sanitizePomodoroSettings,
} from '../lib/timer-settings.ts';

test('timer settings clamp untrusted numeric input to the UI contract', () => {
  const normalized = normalizeTimerSettingsInput({
    focusHours: '999999',
    focusMinutes: '-4',
    focusSeconds: '999',
    shortBreakMinutes: '-10',
    longBreakMinutes: '9000',
    sessionsBeforeLongBreak: '1000000000',
  });

  assert.deepEqual(normalized.settings, {
    focusDuration: 23 * 60 + 1,
    shortBreakDuration: 1,
    longBreakDuration: 60,
    sessionsBeforeLongBreak: 10,
  });
  assert.equal(normalized.presetFields.focusHours, 23);
  assert.equal(normalized.presetFields.focusMinutes, 0);
  assert.equal(normalized.presetFields.focusSeconds, 59);
});

test('persisted Pomodoro settings cannot create negative durations or an enormous session indicator', () => {
  assert.deepEqual(sanitizePomodoroSettings({
    focusDuration: -1,
    shortBreakDuration: -50,
    longBreakDuration: Number.POSITIVE_INFINITY,
    sessionsBeforeLongBreak: 10_000_000,
  }), {
    focusDuration: 1,
    shortBreakDuration: 1,
    longBreakDuration: 15,
    sessionsBeforeLongBreak: 10,
  });
});

test('malformed timer presets are filtered and valid values are bounded', () => {
  const presets = parseTimerPresets([
    null,
    { id: '', name: 'No id' },
    {
      id: 'preset-1',
      name: '  Deep work  ',
      focusHours: 2,
      focusMinutes: 75,
      focusSeconds: -1,
      shortBreakMinutes: 8,
      longBreakMinutes: 20,
      sessionsBeforeLongBreak: 500,
    },
  ]);

  assert.deepEqual(presets, [{
    id: 'preset-1',
    name: 'Deep work',
    focusHours: 2,
    focusMinutes: 59,
    focusSeconds: 0,
    shortBreakMinutes: 8,
    longBreakMinutes: 20,
    sessionsBeforeLongBreak: 10,
  }]);
});
