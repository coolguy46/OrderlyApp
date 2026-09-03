import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('goal and exam progress controls synchronously reject duplicate in-flight writes', async () => {
  const [goalSource, examSource] = await Promise.all([
    readFile(new URL('../components/goals/GoalList.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/exams/ExamList.tsx', import.meta.url), 'utf8'),
  ]);

  for (const source of [goalSource, examSource]) {
    assert.match(source, /if \(progressUpdateInFlightRef\.current\) return/);
    assert.match(source, /progressUpdateInFlightRef\.current = true/);
    assert.match(source, /finally \{[\s\S]*progressUpdateInFlightRef\.current = false/);
  }
});

test('calendar blocks use sibling native controls instead of nested interactive roles', async () => {
  const source = await readFile(
    new URL('../components/planner/WeekTimeGrid.tsx', import.meta.url),
    'utf8',
  );
  const positionedBlock = source.slice(
    source.indexOf('function PositionedBlock('),
    source.indexOf('function DayColumn('),
  );

  assert.match(positionedBlock, /setActivatorNodeRef/);
  assert.match(positionedBlock, /<button[\s\S]*ref=\{setActivatorNodeRef\}/);
  assert.doesNotMatch(positionedBlock, /role="button"/);
  assert.match(positionedBlock, /aria-label=\{`Move \$\{block\.title\} to untimed`\}/);
  assert.match(positionedBlock, /aria-label=\{`Resize \$\{block\.title\}/);
});
