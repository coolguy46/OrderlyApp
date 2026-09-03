import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [modalSource, dialogSource, taskFormSource] = await Promise.all([
  readFile(new URL('../components/ui/Modal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/ui/dialog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/tasks/TaskForm.tsx', import.meta.url), 'utf8'),
]);

test('Modal stays viewport-bounded while only its body scrolls', () => {
  assert.match(
    modalSource,
    /flex w-\[calc\(100%-2rem\)\][^']*flex-col[^']*overflow-hidden/,
  );
  assert.match(
    modalSource,
    /style=\{\{ maxHeight: 'min\(calc\(100dvh - 2rem\), 900px\)' \}\}/,
  );
  assert.match(modalSource, /<DialogHeader className="[^"]*shrink-0/);
  assert.match(modalSource, /<DialogBody[\s\S]*<\/DialogBody>/);
});

test('DialogBody is a touch-friendly scroll region that can receive keyboard focus', () => {
  assert.match(
    dialogSource,
    /scroll-touch min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain/,
  );
  assert.match(modalSource, /role="region"/);
  assert.match(modalSource, /aria-label=\{title \? `\$\{title\} content` : 'Dialog content'\}/);
  assert.match(modalSource, /tabIndex=\{0\}/);
  assert.match(modalSource, /focus-visible:ring-2/);
});

test('TaskForm keeps its header and actions visible while the fields scroll', () => {
  assert.match(taskFormSource, /import \{[\s\S]*DialogBody,[\s\S]*\} from '@\/components\/ui\/dialog'/);
  assert.match(
    taskFormSource,
    /className="flex max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-\[540px\] sm:overflow-hidden"/,
  );
  assert.match(
    taskFormSource,
    /style=\{\{ maxHeight: 'min\(calc\(100dvh - 1rem\), 900px\)' \}\}/,
  );
  assert.match(taskFormSource, /<form[^>]*className="flex min-h-0 flex-1 flex-col"/);
  assert.match(
    taskFormSource,
    /<DialogBody[\s\S]*aria-label=\{isEventMode \? 'Event details' : 'Task details'\}[\s\S]*tabIndex=\{0\}[\s\S]*<\/DialogBody>/,
  );
  assert.match(taskFormSource, /h-24 min-h-20 max-h-40 resize-y overflow-y-auto[^"\n]*field-sizing-fixed/);
  assert.match(taskFormSource, /flex shrink-0 gap-2 border-t[^"\n]*bg-background\/95/);

  const bodyEnd = taskFormSource.indexOf('</DialogBody>');
  const actionsStart = taskFormSource.indexOf('{/* Actions */}');
  assert.ok(bodyEnd > 0 && actionsStart > bodyEnd, 'actions should sit outside the scrollable form body');
});
