import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [modalSource, dialogSource, taskFormSource, detailSource] = await Promise.all([
  readFile(new URL('../components/ui/Modal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/ui/dialog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/tasks/TaskForm.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/tasks/TaskDetailViewer.tsx', import.meta.url), 'utf8'),
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
  // The surface/radius/desktop width can change in a redesign. The actual
  // flex containment and scroll boundary must not: fields alone should scroll.
  const contentClasses = taskFormSource.match(/<DialogContent[^>]*className="([^"]+)"/)?.[1].split(/\s+/) || [];
  for (const className of ['flex', 'max-h-none', 'flex-col', 'gap-0', 'overflow-hidden', 'p-0', 'sm:overflow-hidden']) {
    assert.ok(contentClasses.includes(className), `TaskForm retains ${className}`);
  }
  assert.ok(contentClasses.some(className => /^sm:max-w-\[\d+px\]$/.test(className)), 'desktop dialog remains width bounded');
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
  assert.match(taskFormSource, /grid shrink-0 grid-cols-2 gap-2 border-t[^"\n]*bg-(?:card|background\/95)/);

  const bodyEnd = taskFormSource.indexOf('</DialogBody>');
  const actionsStart = taskFormSource.indexOf('{/* Actions */}');
  assert.ok(bodyEnd > 0 && actionsStart > bodyEnd, 'actions should sit outside the scrollable form body');
});

test('optional description has an accessible disclosure and preserves its mounted input', () => {
  assert.match(taskFormSource, /aria-expanded=\{descriptionExpanded\}/);
  assert.match(taskFormSource, /aria-controls="task-description-fields"/);
  assert.match(taskFormSource, /setDescriptionExpanded\(expanded => !expanded\)/);
  assert.match(taskFormSource, /id="task-description-fields" hidden=\{!descriptionExpanded\}/);
  assert.match(taskFormSource, /<Label htmlFor="description" className="sr-only">Description<\/Label>/);
  assert.match(taskFormSource, /setDescriptionExpanded\(Boolean\(task\.description\)\)/);
  assert.match(taskFormSource, /setDescriptionExpanded\(Boolean\(occurrence\.description\)\)/);
  assert.match(taskFormSource, /setDescriptionExpanded\(Boolean\(override\?\.description !== undefined \? override\.description : commitment\.description\)\)/);

  const disclosureStart = taskFormSource.indexOf('<div id="task-description-fields"');
  const disclosureEnd = taskFormSource.indexOf('</div>', disclosureStart);
  const descriptionInput = taskFormSource.indexOf('id="description"', disclosureStart);
  const scheduleInput = taskFormSource.indexOf('id="scheduleDate"');
  assert.ok(descriptionInput > disclosureStart && descriptionInput < disclosureEnd);
  assert.ok(scheduleInput > disclosureEnd, 'schedule controls stay outside the optional disclosure');
});

test('task information remains keyboard scrollable with completion outside the body', () => {
  assert.match(detailSource, /aria-label="Task information"[\s\S]*tabIndex=\{0\}/);
  assert.match(detailSource, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(detailSource, /\[overflow-wrap:anywhere\]/);
  assert.match(detailSource, /h-10 w-full gap-1\.5 sm:ml-auto sm:w-auto/);
  const footer = detailSource.indexOf('<DialogFooter');
  assert.ok(footer > detailSource.indexOf('aria-label="Task information"'));
  assert.ok(detailSource.indexOf('onClick={handleComplete}') > footer);
});
