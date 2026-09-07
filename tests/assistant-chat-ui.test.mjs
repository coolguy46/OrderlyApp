import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const plannerUrl = new URL('../components/planner/Planner.tsx', import.meta.url);
const chatUrl = new URL('../components/planner/assistant/AssistantChat.tsx', import.meta.url);

test('Assistant sends natural conversation to one semantic API, without parser interception', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const submit = source.slice(source.indexOf('const submitCommand'), source.indexOf('const undoChatChange'));
  assert.match(submit, /fetch\('\/api\/planner\/conversation'/);
  assert.match(submit, /messages: \[\.\.\.messages, userMessage\]\.slice\(-CHAT_CONTEXT_LIMIT\)/);
  assert.match(submit, /chatSendLockRef\.current/);
  assert.match(submit, /requestId: crypto\.randomUUID\(\)/);
  assert.match(submit, /retryRequestRef\.current = body/);
  assert.doesNotMatch(submit, /interpretDirectScheduleRequest|normalizedCommands|PreserveIntent|resolveAssistantTaskQuery/);
  const route = await readFile(new URL('../app/api/planner/conversation/route.ts', import.meta.url), 'utf8');
  assert.match(route, /assistant_calendar_snapshot/);
  assert.match(route, /conversationFacts\(calendar, receipts\)/);
  assert.match(route, /parseConversationIntent\(raw\)/);
  assert.match(route, /compileConversation\(intent, calendar\)/);
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
  assert.match(source, /kind: 'task_plan'/);
  assert.match(source, /request: previewPlanRequest/);
  assert.match(source, /kind: 'commands'/);
  assert.match(source, /commands: preview\.commands\.slice\(0, 8\)/);
  assert.match(source, /plannedAt: previewPlanNow/);
  assert.match(source, /validatedLocalDate: previewValidatedLocalDate/);
  assert.match(source, /storedDraft\.kind === 'task_plan'/);
  assert.match(source, /buildAssistantTaskPlan\(\{/);
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
    source.indexOf('const undo ='),
  );

  assert.match(applySection, /const saveNow = new Date\(\)\.toISOString\(\)/);
  assert.match(applySection, /const refreshedPreview = previewPlanRequest/);
  assert.match(applySection, /buildAssistantTaskPlan\(\{/);
  assert.match(applySection, /request: previewPlanRequest,\s+now: saveNow/);
  assert.match(applySection, /interpretScheduleCommands\(preview\.commands/);
  assert.match(applySection, /now: saveNow,[\s\S]*selectedDate: previewAnchorDate \|\| context\.selectedDate/);
  assert.match(applySection, /withoutPastPlacements\(refreshedPreview, saveNow\)/);
  assert.match(applySection, /JSON\.stringify\(freshPreview\.actions\) !== JSON\.stringify\(preview\.actions\)/);
  assert.match(applySection, /setPreviewPlanNow\(saveNow\)/);
  assert.match(applySection, /for \(const action of freshPreview\.actions\)/);
  assert.match(applySection, /refreshed the draft on the calendar/);
  assert.match(source, /function scheduleDraftBlocks/);
  assert.match(source, /Assistant draft on calendar/);
  assert.match(source, /Save changes/);
  assert.match(source, /Discard/);
  assert.doesNotMatch(source, /preview=\{activePreview\}/);
  assert.match(applySection, /waitForSchedulePersistence/);
  assert.match(applySection, /waitForPlannerPersistence/);
});

test('Assistant persists events as calendar commitments with rollback and undo', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo ='),
  );

  assert.match(source, /scheduleEventActionToCommitment/);
  assert.match(applySection, /action\.type === 'create_event'/);
  assert.match(applySection, /upsertCommitment\(operationUserId, commitment\)/);
  assert.match(applySection, /createdCommitmentIds\.push\(commitmentId\)/);
  assert.match(applySection, /removeCommitment\(operationUserId, id\)/);
  assert.match(applySection, /deleteCreatedTasks\(/);
  assert.match(applySection, /cleanup\.failedTaskIds\.length > 0/);
  assert.match(source, /Retry cleanup/);
  assert.match(source, /for \(const commitmentId of snapshot\.createdCommitmentIds \|\| \[\]\)/);
  assert.match(source, /removeCommitment\(operationUserId, commitmentId\)/);
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

test('event drag and resize replace stale Undo with the exact prior event state', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const installSection = source.slice(
    source.indexOf('const installUndoState'),
    source.indexOf('useEffect(() => {', source.indexOf('const installUndoState')),
  );
  const persistenceSection = source.slice(
    source.indexOf('const persistCommitmentOccurrence'),
    source.indexOf('const handleMove'),
  );
  const dragSection = source.slice(
    source.indexOf('const handleMove'),
    source.indexOf('const startNewChat'),
  );

  assert.match(installSection, /const previous = activeUndoRef\.current/);
  assert.match(installSection, /finalizeTaskCreations\(previous\.createdTaskIds\)/);
  assert.match(installSection, /activeUndoRef\.current = installed/);
  assert.match(installSection, /setUndoState\(installed\)/);
  assert.match(persistenceSection, /const previousEvent = storedEvents\.find/);
  assert.match(persistenceSection, /storedEventSnapshots: \[cloneStoredEvent\(previousEvent\)\]/);
  assert.match(persistenceSection, /commitmentSnapshots: \[cloneCommitment\(commitment\)\]/);
  assert.match(persistenceSection, /writeStoredCalendarEvents\(userId, nextEvents\)/);
  assert.match(persistenceSection, /installUndoState\(\{/);
  assert.match(dragSection, /persistCommitmentOccurrence\(block, nextStart, nextEnd, `Move/);
  assert.match(dragSection, /persistCommitmentOccurrence\(block, nextStart, nextEnd, `Resize/);
  assert.doesNotMatch(dragSection, /setUndoState\(\{/);
});

test('Undo conditionally completes account-keyed rollback before guarding active-account UI', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo ='),
  );
  const undoSection = source.slice(
    source.indexOf('const undo ='),
    source.indexOf('const persistCommitmentOccurrence'),
  );

  assert.match(applySection, /addTask\([\s\S]*\{ reversible: true \}\)/);
  assert.match(applySection, /installUndoState\(\{[\s\S]*createdTaskIds/);
  assert.doesNotMatch(applySection, /finalizeTaskCreations\(createdTaskIds\)/);
  assert.match(undoSection, /inFlightUndoRef\.current = snapshot/);
  assert.match(undoSection, /removeCommitment\(operationUserId, commitmentId\)/);
  assert.match(undoSection, /upsertCommitment\(operationUserId, cloneCommitment\(commitment\)\)/);
  assert.match(undoSection, /readStoredCalendarEvents\(operationUserId\)/);
  assert.match(undoSection, /writeStoredCalendarEvents\(operationUserId, restoredEvents\)/);
  assert.match(undoSection, /restoreScheduleSnapshotPreservingChanges\(/);
  assert.match(undoSection, /snapshot\.appliedEntries \|\| snapshot\.entries/);
  assert.match(undoSection, /useScheduleStore\.getState\(\)\.entriesByUser/);
  assert.match(undoSection, /replaceUserSchedules\(operationUserId, cloneEntries\(scheduleRestore\.entries\)\)/);

  const activeAccountGuard = undoSection.indexOf('if (!operationIsCurrent()) return;');
  assert.ok(activeAccountGuard > 0, 'Undo must guard UI after account-keyed rollback');
  for (const accountKeyedMutation of [
    'removeCommitment(operationUserId, commitmentId)',
    'upsertCommitment(operationUserId, cloneCommitment(commitment))',
    'writeStoredCalendarEvents(operationUserId, restoredEvents)',
    'replaceUserSchedules(operationUserId, cloneEntries(scheduleRestore.entries))',
  ]) {
    assert.ok(
      undoSection.indexOf(accountKeyedMutation) < activeAccountGuard,
      `${accountKeyedMutation} must finish before active-account UI is guarded`,
    );
  }
  assert.ok(
    undoSection.indexOf('setMessages(previous =>', activeAccountGuard) > activeAccountGuard,
    'Undo messages must only update the still-active account',
  );
});

test('schedule Undo snapshots capture the applied state after synchronous drag mutations', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const installSection = source.slice(
    source.indexOf('const installUndoState'),
    source.indexOf('useEffect(() => {', source.indexOf('const installUndoState')),
  );
  const moveSection = source.slice(
    source.indexOf('const handleMove'),
    source.indexOf('const handleResize'),
  );

  assert.match(installSection, /appliedEntries: next\.appliedEntries \|\| cloneEntries\(selectScheduleEntriesForUser\(/);
  assert.ok(
    moveSection.indexOf('upsertTaskSchedule(userId, task.id') < moveSection.indexOf('installUndoState({ userId, entries: previousEntries'),
    'the applied schedule must exist before Undo captures its conflict guard',
  );
});

test('chat displays success only from confirmed saved results, and refreshes the main calendar', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const submit = source.slice(source.indexOf('const submitCommand'), source.indexOf('const undoChatChange'));
  assert.match(submit, /if \(result.saved\)/);
  assert.match(submit, /refreshData\(\)/);
  assert.match(submit, /content: result.reply/);
  assert.match(submit, /setCalendarOpen\(true\)/);
  assert.match(submit, /selectDay\(localDateCarrier\(date\)\)/);
  assert.match(submit, /window.sessionStorage.setItem/);
  assert.match(source, /Check last request/);
  assert.match(source, /Undo last chat change/);
  assert.doesNotMatch(submit, /presentCommandPreview|presentTaskPlanPreview/);
});

test('follow-ups use confirmed server receipts rather than matching old assistant prose', async () => {
  const source = await readFile(new URL('../app/api/planner/conversation/route.ts', import.meta.url), 'utf8');
  assert.match(source, /eq\('conversation_id', input.conversationId\)/);
  assert.match(source, /confirmed|receipts/);
  assert.match(source, /\.\.\.input.messages/);
  assert.match(source, /attempt < 3/);
  assert.match(source, /if \(repairs\+\+ >= 1\) break/);
  assert.match(source, /if \(inspected\) throw/);
  assert.match(source, /Validation feedback/);
  assert.doesNotMatch(source, /lastAssistantMessage.content ===|inferPlannerChat|normalizedCommands/);
});

test('Assistant drafts expire safely across a local-date boundary', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo ='),
  );

  assert.match(source, /type StoredAssistantDraft =/);
  assert.match(source, /kind: 'commands';\s+commands: string\[\];\s+validatedLocalDate: LocalDate;\s+plannedAt: string;/);
  assert.match(source, /plannedAt: string;\s+anchorDate: LocalDate;/);
  assert.match(source, /kind: 'task_plan';\s+request: AssistantTaskPlanRequest;\s+validatedLocalDate: LocalDate;\s+plannedAt: string;/);
  assert.match(source, /storedDraft\.validatedLocalDate !== currentLocalDate/);
  assert.match(source, /selectedDate: storedDraft\.anchorDate/);
  assert.match(source, /anchorDate: previewAnchorDate \|\| previewValidatedLocalDate/);
  assert.match(applySection, /previewValidatedLocalDate !== currentLocalDate/);
  assert.match(applySection, /calendar draft expired at midnight/i);
  assert.match(applySection, /setPreview\(null\);\s+setPreviewPlanRequest\(null\);\s+setPreviewPlanNow\(null\);\s+setPreviewAnchorDate\(null\);\s+setPreviewValidatedLocalDate\(null\)/);
});

test('semantic protocol rejects invalid plans and separates discussion from writes', async () => {
  const source = await readFile(new URL('../lib/planner/conversation.ts', import.meta.url), 'utf8');
  assert.match(source, /Discussion cannot contain writes/);
  assert.match(source, /Existing item ID required/);
  assert.match(source, /number\(p.horizonDays, 1, MAX_CALENDAR_DAYS\)/);
  assert.match(source, /new Intl.DateTimeFormat\('en', \{ timeZone \}\)/);
});

test('Assistant save guard cannot apply a newly placed block in the past', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const guardSection = source.slice(
    source.indexOf('function scheduledPlacementStarts'),
    source.indexOf('function conflictingBlock'),
  );

  assert.match(guardSection, /action\.schedule\.startAt/);
  assert.match(guardSection, /operation\.type === 'upsert'/);
  assert.match(guardSection, /operation\.type === 'override'/);
  assert.match(guardSection, /startTime < nowTime/);
  assert.match(guardSection, /status: 'clarification'/);
  assert.match(guardSection, /actions: \[\]/);
  assert.match(guardSection, /occurrences: \[\]/);
});

test('chat UI keeps the composer visible and calendar controls secondary', async () => {
  const [plannerSource, chatSource] = await Promise.all([
    readFile(plannerUrl, 'utf8'),
    readFile(chatUrl, 'utf8'),
  ]);

  assert.match(chatSource, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(chatSource, /shrink-0 border-t/);
  assert.match(chatSource, /New chat/);
  assert.match(chatSource, /Stop response/);
  assert.match(chatSource, /Changes save to your calendar/);
  assert.doesNotMatch(chatSource, /Proposed schedule change/);
  assert.match(plannerSource, /aria-expanded=\{calendarOpen\}/);
  assert.match(plannerSource, /setCalendarExpanded/);
  assert.match(plannerSource, /taskDetailsOpen &&/);
});
