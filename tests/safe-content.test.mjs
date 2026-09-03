import assert from 'node:assert/strict';
import test from 'node:test';

import { externalHtmlToPlainText, safeExternalUrl } from '../lib/safe-content.ts';

test('external HTML becomes inert readable text', () => {
  const value = '<p>Hello <strong>student</strong></p><p>Second&nbsp;line</p>';
  assert.equal(externalHtmlToPlainText(value), 'Hello student\n\nSecond line');
});

test('Canvas paragraph links remain useful without rendering provider HTML', () => {
  const value = [
    '<p><a class="inline_disabled" title="Link"',
    ' href="https://drive.google.com/file/d/1Ntw4_G46KOgey_cTlw4vwuscm?usp=sharing&amp;mode=preview"',
    ' target="_blank">You will complete the SPACE CAT form and submit.</a></p>',
    '<p>You do not need to complete the C - CHOICES.</p>',
    '<p>&nbsp;</p>',
  ].join('');

  const normalized = externalHtmlToPlainText(value);
  assert.equal(
    normalized,
    [
      'You will complete the SPACE CAT form and submit. (https://drive.google.com/file/d/1Ntw4_G46KOgey_cTlw4vwuscm?usp=sharing&mode=preview)',
      'You do not need to complete the C - CHOICES.',
    ].join('\n\n'),
  );
  assert.equal(externalHtmlToPlainText(normalized), normalized);
});

test('unsafe anchor protocols are discarded while visible instructions remain', () => {
  const value = [
    '<p><a href="javascript:alert(1)">Read the chapter</a></p>',
    '<p><a href="data:text/html,%3Cscript%3Ealert(2)%3C/script%3E">Submit your notes</a></p>',
  ].join('');

  assert.equal(externalHtmlToPlainText(value), 'Read the chapter\n\nSubmit your notes');
});

test('active and embedded content is discarded', () => {
  const value = [
    '<img src=x onerror="alert(1)">Visible',
    '<svg onload="alert(2)"><text>hidden</text></svg>',
    '<script>alert(3)</script>',
    '<iframe src="https://attacker.example"></iframe>',
  ].join('');
  const result = externalHtmlToPlainText(value);

  assert.equal(result, 'Visible');
  assert.doesNotMatch(result, /alert|attacker|onerror/i);
});

test('entity-encoded active markup remains inert and idempotent', () => {
  const value = '&lt;img src=x onerror=alert(1)&gt;';
  const normalized = externalHtmlToPlainText(value);

  assert.equal(normalized, value);
  assert.equal(externalHtmlToPlainText(normalized), normalized);
});

test('entity-encoded instructional tags survive repeated normalization', () => {
  const value = '<p>Type &lt;strong&gt; exactly</p>';
  const normalized = externalHtmlToPlainText(value);

  assert.equal(normalized, 'Type <strong> exactly');
  assert.equal(externalHtmlToPlainText(normalized), normalized);
});

test('unsupported tags are stripped without dropping their readable text', () => {
  assert.equal(externalHtmlToPlainText('<marquee>Hello</marquee>'), 'Hello');
  assert.equal(
    externalHtmlToPlainText('<custom-tag data-x="1">Hi</custom-tag>'),
    'Hi',
  );
});

test('unclosed dangerous elements discard their active contents through EOF', () => {
  assert.equal(externalHtmlToPlainText('Visible<script>alert(1)'), 'Visible');
  assert.equal(externalHtmlToPlainText('Visible<style>body { display: none }'), 'Visible');
  assert.equal(externalHtmlToPlainText('<svg><text>hidden</text>'), '');
});

test('void elements do not discard readable text that follows them', () => {
  assert.equal(externalHtmlToPlainText('<embed src="https://example.com/file">Keep this instruction'), 'Keep this instruction');
});

test('quoted greater-than characters do not end anchor tags early', () => {
  assert.equal(
    externalHtmlToPlainText('<a title="1 > 0" href="https://example.com">Open</a>'),
    'Open (https://example.com/)',
  );
});

test('only an exact href attribute supplies the preserved link', () => {
  assert.equal(
    externalHtmlToPlainText('<a data-href="https://wrong.example" href="https://right.example">Open</a>'),
    'Open (https://right.example/)',
  );
  assert.equal(
    externalHtmlToPlainText('<a title=" href=&quot;https://wrong.example&quot;">Open</a>'),
    'Open',
  );
});

test('plain comparison text is not mistaken for an HTML tag', () => {
  assert.equal(externalHtmlToPlainText('Solve 2 < 3 and 5 > 4'), 'Solve 2 < 3 and 5 > 4');
});

test('compact comparisons and generic notation remain exact in plain text and HTML paragraphs', () => {
  for (const value of [
    'Compare x<y and y>z',
    'If a<b and c>d, continue',
    'Use List<T> here',
  ]) {
    assert.equal(externalHtmlToPlainText(value), value);
    assert.equal(externalHtmlToPlainText(`<p>${value}</p>`), value);
  }
});

test('external links only allow HTTP and HTTPS', () => {
  assert.equal(safeExternalUrl('https://canvas.example/assignment/1'), 'https://canvas.example/assignment/1');
  assert.equal(safeExternalUrl('http://localhost:3000/task'), 'http://localhost:3000/task');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeExternalUrl('//attacker.example/path'), null);
  assert.equal(safeExternalUrl('not a URL'), null);
});
