import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';
import { emptyTutorialProgress, parseTutorialProgress, tutorialStorageKey } from '../lib/tutorial-progress.ts';
import { TUTORIAL_SECTIONS } from '../components/tutorial/sections.ts';

const ids = TUTORIAL_SECTIONS.map(section => section.id);
test('tutorial progress is scoped, validated and tolerant of old or corrupt values', () => {
  assert.equal(tutorialStorageKey(null), null);
  assert.notEqual(tutorialStorageKey('alex'), tutorialStorageKey('jamie'));
  for (const raw of [null, '', '{invalid', '[]', 'false', 'null']) {
    assert.deepEqual(parseTutorialProgress(raw, ids), emptyTutorialProgress());
  }
  assert.deepEqual(parseTutorialProgress(JSON.stringify({ current:'removed',visited:['tasks','tasks','removed',3],dismissed:'true',completed:true }), ids),
    {current:null,visited:['tasks'],dismissed:false,completed:true});
});

test('all tutorial sections have real local assets, useful instructions and destinations; Canvas is last', async () => {
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.at(-1), 'canvas');
  for (const section of TUTORIAL_SECTIONS) {
    assert.ok(section.imageAlt.length > 30);
    assert.ok(section.href.startsWith('/') && !section.href.startsWith('//'));
    assert.ok(section.id === 'canvas' || section.steps.length >= 3);
    await access(new URL(`../public/tutorial/${section.image}.webp`, import.meta.url));
  }
  const layout = await readFile(new URL('../components/layout/MainLayout.tsx', import.meta.url), 'utf8');
  const header = await readFile(new URL('../components/layout/Header.tsx', import.meta.url), 'utf8');
  const integrations = await readFile(new URL('../app/settings/integrations/page.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<TutorialProvider userId=\{user\?\.id\}>/);
  assert.match(layout, /pathname === '\/' && <TutorialInvitation/);
  assert.match(header, /<TutorialHelpButton \/>\s*<DropdownMenu>/);
  assert.match(integrations, /<CanvasGuide \/>/);
});
