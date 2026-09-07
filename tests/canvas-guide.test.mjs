import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guide = await readFile(new URL('../components/tutorial/CanvasGuide.tsx', import.meta.url), 'utf8');
const integrations = await readFile(new URL('../app/settings/integrations/page.tsx', import.meta.url), 'utf8');

test('Canvas guide follows the feed flow and uses the actual connection labels', () => {
  const titles = [
    'Log into Canvas',
    'Open Calendar',
    'Choose Calendar Feed',
    'Copy the feed link',
    'Open Orderly’s Integrations',
    'Paste and connect',
  ];
  let previousIndex = -1;
  for (const title of titles) {
    const index = guide.indexOf(`title: '${title}'`);
    assert.ok(index > previousIndex, `${title} should appear in connection order`);
    previousIndex = index;
  }
  for (const control of ['Calendar feed URL', 'Connect Canvas', 'Last synced', 'Sync now', 'Automatic updates', 'Turn on']) {
    assert.ok(guide.includes(control), `guide names ${control}`);
    assert.ok(integrations.includes(control), `${control} exists in the actual interface`);
  }
  assert.match(guide, /Connected means your link is saved/);
  assert.match(guide, /Last synced time confirms an import finished/);
  assert.doesNotMatch(guide, /https?:\/\/|api[- ]?key|access[- ]?token/i);
});

test('shared Canvas help is available independently of connection status and never mutates data', () => {
  assert.match(integrations, /import CanvasGuide from '@\/components\/tutorial\/CanvasGuide'/);
  assert.equal(integrations.match(/<CanvasGuide\s*\/>/g)?.length, 1);
  assert.match(integrations, /<details open=\{!canvasSettings\.icalUrl\}[\s\S]*Canvas connection guide[\s\S]*<CanvasGuide \/>/);
  assert.ok(integrations.indexOf('<CanvasGuide />') > integrations.lastIndexOf('</Card>'));
  assert.doesNotMatch(guide, /useAppStore|useCanvasSync|fetch\(|localStorage|supabase|onClick=/);
  assert.match(guide, /<ol[\s\S]*<li/);
  assert.match(guide, /<details[\s\S]*<summary[\s\S]*focus-visible:ring-2/);
  assert.match(guide, /Keep your feed link private/);
  assert.match(guide, /does not submit it or change Canvas/);
});
