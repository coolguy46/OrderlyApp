import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const plannerUrl = new URL('../components/planner/Planner.tsx', import.meta.url);
const chatUrl = new URL('../components/planner/assistant/AssistantChat.tsx', import.meta.url);

test('Assistant uses the bounded multi-turn chat API contract', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(source, /fetch\('\/api\/planner\/chat'/);
  assert.match(source, /messages: conversation\.map\(message => \(\{ role: message\.role, content: message\.content \}\)\)/);
  assert.match(source, /tasks: pendingTasks\.slice\(0, 30\)/);
  assert.match(source, /dueDate: task\.due_date/);
  assert.match(source, /dueTime: task\.due_time/);
  assert.match(source, /\.slice\(0, 20\)[\s\S]*examDate: exam\.exam_date/);
  assert.match(source, /occurrences: context\.occurrences\.slice\(0, 80\)/);
  assert.match(source, /busy: \(context\.busy \|\| \[\]\)\.slice\(0, 80\)/);
  assert.match(source, /interpretScheduleCommands\(payload\.normalizedCommands/);
  assert.match(source, /payload\.normalizedCommands\.length > 0/);
});

test('Assistant history is account-scoped and bounded', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(source, /const CHAT_STORAGE_PREFIX = 'orderly:assistant-chat:v2:'/);
  assert.match(source, /const LEGACY_CHAT_STORAGE_PREFIX = 'orderly:assistant-chat:v1:'/);
  assert.match(source, /const CHAT_STORAGE_LIMIT = 20/);
  assert.match(source, /const CHAT_STORAGE_CHARACTER_LIMIT = 20_000/);
  assert.match(source, /const DRAFT_STORAGE_PREFIX = 'orderly:assistant-calendar-draft:v2:'/);
  assert.match(source, /const LEGACY_DRAFT_STORAGE_PREFIX = 'orderly:assistant-calendar-draft:v1:'/);
  assert.match(source, /sessionStorage\.getItem\(assistantChatStorageKey\(userId\)\)/);
  assert.match(source, /sessionStorage\.setItem\(/);
  assert.match(source, /sessionStorage\.removeItem\(assistantChatStorageKey\(userId\)\)/);
  assert.match(source, /localStorage\.removeItem\(assistantChatStorageKey\(userId\)\)/);
  assert.match(source, /clearLegacyAssistantChatStorage\(userId\)/);
  assert.match(source, /readStoredAssistantDraft\(userId\)/);
  assert.match(source, /commands: preview\.commands\.slice\(0, 8\)/);
  assert.match(source, /validatedLocalDate: previewValidatedLocalDate/);
  assert.match(source, /interpretScheduleCommands\(storedDraft\.commands/);
  assert.match(source, /if \(!userId \|\| !dataLoaded \|\| chatOwnerUserId !== userId/);
  assert.match(source, /storedDraft\.validatedLocalDate !== currentLocalDate/);
});

test('account changes isolate chat, quota, and undo snapshots immediately', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(source, /interface UndoState \{\s+userId: string;/);
  assert.match(source, /if \(!userId \|\| !undoState \|\| undoState\.userId !== userId\) return/);
  assert.match(source, /undoState\?\.userId === userId/);
  assert.match(source, /setUndoState\(null\);\s+setUsage\(null\)/);
  assert.match(source, /const chatReady = chatOwnerUserId === userId/);
  assert.match(source, /messages=\{activeMessages\}/);
  assert.match(source, /setPreview\(null\)/);
  assert.match(source, /usage=\{activeUsage\}/);
});

test('Assistant UI does not show or enforce stale daily/monthly quota values', async () => {
  const source = await readFile(chatUrl, 'utf8');

  assert.doesNotMatch(source, /AI messages? left today/i);
  assert.doesNotMatch(source, /used your Assistant allowance/i);
  assert.doesNotMatch(source, /Assistant limit reached/i);
  assert.doesNotMatch(source, /disabled=\{quotaExhausted\}/);
  assert.doesNotMatch(source, /!quotaExhausted/);
});

test('Assistant replies render safe paragraphs, line breaks, lists, and bold text', async () => {
  const source = await readFile(chatUrl, 'utf8');

  assert.match(source, /function parseAssistantMessageBlocks/);
  assert.match(source, /function normalizeAssistantMessageLines/);
  assert.match(source, /Older stored replies were flattened/);
  assert.match(source, /\(\?=\[-\+\*\]\\s\+\(\?:\\\*\\\*\|__\)\)/);
  assert.match(source, /kind: 'paragraph'/);
  assert.match(source, /'unordered-list' \| 'ordered-list'/);
  assert.match(source, /<p key=/);
  assert.match(source, /<br \/>/);
  assert.match(source, /<strong key=/);
  assert.match(source, /const List = block\.kind === 'ordered-list' \? 'ol' : 'ul'/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML\s*=/);
});

test('Assistant stages changes on the calendar and revalidates before saving', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo'),
  );

  assert.match(applySection, /const freshPreview = interpretScheduleCommands\(preview\.commands/);
  assert.match(applySection, /JSON\.stringify\(freshPreview\.actions\) !== JSON\.stringify\(preview\.actions\)/);
  assert.match(applySection, /refreshed the draft on the calendar/);
  assert.match(source, /function scheduleDraftBlocks/);
  assert.match(source, /Assistant draft on calendar/);
  assert.match(source, /Save changes/);
  assert.match(source, /Discard/);
  assert.doesNotMatch(source, /preview=\{activePreview\}/);
});

test('follow-up chat keeps an unsaved calendar draft and accepts atomic command bundles', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const submitSection = source.slice(
    source.indexOf('const submitCommand'),
    source.indexOf('const applyPreview'),
  );

  const mutationBranch = submitSection.slice(submitSection.indexOf('if (payload.normalizedCommands.length > 0)'));
  const questionOnlyPath = submitSection.slice(0, submitSection.indexOf('if (payload.normalizedCommands.length > 0)'));

  assert.doesNotMatch(questionOnlyPath, /setPreview\(null\)/);
  assert.match(mutationBranch, /if \(payload\.normalizedCommands\.length > 0\)/);
  assert.match(submitSection, /setPreview\(nextPreview\)/);
  assert.match(mutationBranch, /else \{\s+setPreview\(null\);\s+setPreviewValidatedLocalDate\(null\);/);
  assert.match(submitSection, /one draft/);
});

test('Assistant drafts expire safely across a local-date boundary', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo'),
  );

  assert.match(source, /interface StoredAssistantDraft \{\s+commands: string\[\];\s+validatedLocalDate: LocalDate;/);
  assert.match(source, /storedDraft\.validatedLocalDate !== currentLocalDate/);
  assert.match(applySection, /previewValidatedLocalDate !== currentLocalDate/);
  assert.match(applySection, /calendar draft expired at midnight/i);
  assert.match(applySection, /setPreview\(null\);\s+setPreviewValidatedLocalDate\(null\)/);
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
  assert.doesNotMatch(chatSource, /Proposed schedule change/);
  assert.match(plannerSource, /aria-expanded=\{calendarOpen\}/);
  assert.match(plannerSource, /setCalendarExpanded/);
  assert.match(plannerSource, /taskDetailsOpen &&/);
});
