import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const plannerUrl = new URL('../components/planner/Planner.tsx', import.meta.url);
const chatUrl = new URL('../components/planner/assistant/AssistantChat.tsx', import.meta.url);

test('Assistant uses the bounded multi-turn chat API contract', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(source, /fetch\('\/api\/planner\/chat'/);
  assert.match(source, /messages: conversation\.map\(message => \(\{ role: message\.role, content: message\.content \}\)\)/);
  assert.match(source, /tasks: providerTasks\.slice\(0, 30\)/);
  assert.match(source, /dueDate: task\.due_date/);
  assert.match(source, /dueTime: task\.due_time/);
  assert.match(source, /\.slice\(0, 20\)[\s\S]*examDate: exam\.exam_date/);
  assert.match(source, /occurrences: context\.occurrences\.slice\(0, 80\)/);
  assert.match(source, /busy: \(context\.busy \|\| \[\]\)\.slice\(0, 80\)/);
  assert.match(source, /activeDraft: browserIntentContext\.activeDraft/);
  assert.match(source, /interpretScheduleCommands\(payload\.normalizedCommands/);
  assert.match(source, /describeScheduleCommandDraft\(nextPreview, timeZone\)/);
});

test('Assistant history is account-scoped and bounded', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(source, /orderly:assistant-chat:v2:/);
  assert.match(source, /const CHAT_STORAGE_LIMIT = 20/);
  assert.match(source, /const CHAT_STORAGE_CHARACTER_LIMIT = 20_000/);
  assert.match(source, /sessionStorage\.removeItem\(assistantChatStorageKey\(userId\)\)/);
});

test('Assistant requires a fresh deterministic preview before applying', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo'),
  );

  assert.match(applySection, /interpretScheduleCommands\(preview\.commands/);
  assert.match(applySection, /JSON\.stringify\(freshPreview\.actions\) !== JSON\.stringify\(preview\.actions\)/);
  assert.match(applySection, /refreshed the draft on the calendar/);
  assert.match(applySection, /waitForSchedulePersistence/);
  assert.match(applySection, /waitForPlannerPersistence/);
});

test('Assistant-created tasks and events are persisted before success is reported', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo'),
  );

  assert.match(applySection, /if \(action\.type === 'create_event'\)[\s\S]*upsertCommitment\(operationUserId, commitment\)/);
  assert.match(applySection, /const created = await addTask\([\s\S]*applyScheduleBatch\(operationUserId/);
  assert.match(applySection, /if \(!schedulePersisted \|\| !plannerPersisted\)[\s\S]*throw new Error/);
  assert.match(applySection, /content: `Done — \$\{freshPreview\.summary\}`/);
  assert.ok(
    applySection.indexOf('if (!schedulePersisted || !plannerPersisted)')
      < applySection.indexOf('content: `Done — ${freshPreview.summary}`'),
    'success must be reported only after persistence acknowledgement',
  );
});

test('chat UI keeps the composer visible and calendar controls secondary', async () => {
  const [plannerSource, chatSource] = await Promise.all([
    readFile(plannerUrl, 'utf8'),
    readFile(chatUrl, 'utf8'),
  ]);

  assert.match(chatSource, /sticky bottom-0/);
  assert.match(chatSource, /New chat/);
  assert.match(chatSource, /Stop response/);
  assert.match(chatSource, /Calendar drafts are saved only after you confirm them/);
  assert.match(plannerSource, /aria-expanded=\{calendarOpen\}/);
  assert.match(plannerSource, /setCalendarExpanded/);
  assert.match(plannerSource, /taskDetailsOpen &&/);
});
