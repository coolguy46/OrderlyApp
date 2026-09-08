import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dark polish preserves the shared calm calendar surface palette', async () => {
  const css = await source('app/globals.css');
  const palette = css.match(/(?:^|\n)\.dark\s*\{([^}]+)\}/)?.[1];
  assert.ok(palette, 'the existing dark theme remains present');
  for (const [token, value] of Object.entries({
    background: '#15171c', card: '#1c1f26', primary: '#9693ff',
    'primary-foreground': '#17162b', muted: '#242831', border: '#323640',
  })) {
    assert.match(palette, new RegExp(`--${token}:\\s*${value}\\s*;`), `${token} does not brighten every calendar cell`);
  }
  for (const selector of ['workspace-shell', 'workspace-sidebar', 'workspace-primary-button', 'workspace-metric']) {
    assert.match(css, new RegExp(`\\.dark \\.${selector}\\s*\\{`), `${selector} enhancements are dark-mode scoped`);
  }
});

test('calendar, scheduler and untimed task fills retain their low-opacity treatments', async () => {
  const calendar = await source('components/calendar/TaskCalendar.tsx');
  const scheduler = await source('components/planner/WeekTimeGrid.tsx');
  const untimed = await source('components/schedule/UntimedTaskShelf.tsx');
  assert.ok(calendar.includes('backgroundColor: `${color}12`'), 'calendar task fill remains 7 percent');
  assert.ok(calendar.includes('backgroundColor: `${event.color}18`'), 'calendar event fill remains 9 percent');
  assert.ok(scheduler.includes("colorWithAlpha(color, '14', 'rgba(113, 113, 122, 0.18)')"), 'fixed blocks remain subdued');
  assert.ok(scheduler.includes("colorWithAlpha(color, '2b', 'rgba(99, 102, 241, 0.18)')"), 'scheduled work retains 17 percent fill');
  assert.ok(untimed.includes('`${color}20`'), 'untimed task fill remains 13 percent');
});

test('adapted metric card displays supplied data with decorative, non-interactive accents', async () => {
  const card = await source('components/ui/stat-card.tsx');
  assert.match(card, /data-slot="stat-card" data-tone=\{tone\}/);
  assert.match(card, /aria-hidden="true" className="workspace-metric-icon/);
  for (const prop of ['title', 'value', 'description']) assert.ok(card.includes(`{${prop}}`), `metric renders actual ${prop}`);
  assert.doesNotMatch(card, /Math\.random|setInterval|onClick|<button|<a\s/, 'metric presentation does not invent data or nested controls');
});
