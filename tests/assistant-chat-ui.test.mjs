import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const plannerUrl = new URL('../components/planner/Planner.tsx', import.meta.url);
const chatUrl = new URL('../components/planner/assistant/AssistantChat.tsx', import.meta.url);

test('Assistant uses the bounded multi-turn chat API contract', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(source, /fetch\('\/api\/planner\/chat'/);
  assert.match(source, /messages: conversation\.map\(message => \(\{ role: message\.role, content: message\.content \}\)\)/);
  assert.match(source, /const assistantContextTasks = useMemo/);
  assert.match(source, /tasks: providerTasks\.slice\(0, 30\)/);
  assert.match(source, /taskSummary,/);
  assert.match(source, /dueDate: task\.due_date/);
  assert.match(source, /dueTime: task\.due_time/);
  assert.match(source, /\.slice\(0, 20\)[\s\S]*examDate: exam\.exam_date/);
  assert.match(source, /occurrences: context\.occurrences\.slice\(0, 80\)/);
  assert.match(source, /busy: \(context\.busy \|\| \[\]\)\.slice\(0, 80\)/);
  assert.match(source, /activeDraft: browserIntentContext\.activeDraft/);
  assert.match(source, /interpretScheduleCommands\(payload\.normalizedCommands/);
  assert.match(source, /payload\.normalizedCommands\.length > 0/);
  assert.match(source, /describeScheduleCommandDraft\(nextPreview, timeZone\)/);
  assert.match(source, /interpretDirectScheduleRequest\(normalized, commandContext\)/);
  assert.ok(
    source.indexOf('interpretDirectScheduleRequest(normalized, commandContext)')
      < source.indexOf("fetch('/api/planner/chat'"),
    'direct calendar commands must be validated before the paid AI request',
  );
  assert.match(source, /isUnverifiedCalendarOutcome\(assistantReply\)/);
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
    source.indexOf('const undo'),
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
    source.indexOf('const undo'),
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
    source.indexOf('const undo'),
  );
  const undoSection = source.slice(
    source.indexOf('const undo'),
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

test('follow-up chat keeps an unsaved calendar draft and accepts atomic command bundles', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const submitSection = source.slice(
    source.indexOf('const submitCommand'),
    source.indexOf('const applyPreview'),
  );
  const presentationSection = source.slice(
    source.indexOf('const presentCommandPreview'),
    source.indexOf('const submitCommand'),
  );

  const mutationBranch = submitSection.slice(submitSection.indexOf('if (payload.planRequest)'));
  const questionOnlyPath = submitSection.slice(0, submitSection.indexOf('if (payload.planRequest)'));

  assert.doesNotMatch(questionOnlyPath, /setPreview\(null\)/);
  assert.match(mutationBranch, /if \(payload\.planRequest\)/);
  assert.match(mutationBranch, /else if \(payload\.normalizedCommands\.length > 0\)/);
  assert.match(presentationSection, /setPreview\(nextPreview\)/);
  assert.doesNotMatch(presentationSection, /setPreview\(null\)/);
  assert.match(submitSection, /presentCommandPreview\(nextPreview/);
  assert.match(submitSection, /presentTaskPlanPreview\(planRequest, nextPreview/);
  assert.match(presentationSection, /one draft/);
});

test('a factual task answer can be scheduled by an immediate grounded follow-up', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const submitSection = source.slice(
    source.indexOf('const submitCommand'),
    source.indexOf('const applyPreview'),
  );

  assert.match(submitSection, /const factualResult = resolveAssistantTaskQuery/);
  assert.match(submitSection, /const priorTaskResult = priorUserMessage/);
  assert.match(submitSection, /taskScope: 'task_ids'/);
  assert.match(submitSection, /taskIds: priorTaskResult\.taskIds/);
  assert.match(submitSection, /lastAssistantMessage\.content === priorTaskResult\.reply/);
  assert.match(submitSection, /presentTaskPlanPreview\(/);
});

test('Assistant drafts expire safely across a local-date boundary', async () => {
  const source = await readFile(plannerUrl, 'utf8');
  const applySection = source.slice(
    source.indexOf('const applyPreview'),
    source.indexOf('const undo'),
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

test('Assistant client rejects malformed plan requests before planning', async () => {
  const source = await readFile(plannerUrl, 'utf8');

  assert.match(
    source,
    /candidate\.planRequest === null \|\| sanitizePlannerChatPlanRequest\(candidate\.planRequest\) !== null/,
  );
  assert.match(source, /const planRequest = sanitizePlannerChatPlanRequest\(payload\.planRequest\)/);
  assert.match(source, /if \(!planRequest\) throw new Error\('The Assistant returned an invalid planning request/);
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

  assert.match(chatSource, /sticky bottom-0/);
  assert.match(chatSource, /New chat/);
  assert.match(chatSource, /Stop response/);
  assert.match(chatSource, /Calendar drafts are saved only after you confirm them/);
  assert.doesNotMatch(chatSource, /Proposed schedule change/);
  assert.match(plannerSource, /aria-expanded=\{calendarOpen\}/);
  assert.match(plannerSource, /setCalendarExpanded/);
  assert.match(plannerSource, /taskDetailsOpen &&/);
});
