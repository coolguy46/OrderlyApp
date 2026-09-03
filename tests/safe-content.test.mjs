import assert from 'node:assert/strict';
import test from 'node:test';

import { externalHtmlToPlainText, safeExternalUrl } from '../lib/safe-content.ts';

test('external HTML becomes inert readable text', () => {
  const value = '<p>Hello <strong>student</strong></p><p>Second&nbsp;line</p>';
  assert.equal(externalHtmlToPlainText(value), 'Hello student\n\nSecond line');
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

test('encoded markup remains plain text, never executable markup', () => {
  assert.equal(
    externalHtmlToPlainText('&lt;img src=x onerror=alert(1)&gt;'),
    '<img src=x onerror=alert(1)>'
  );
});

test('external links only allow HTTP and HTTPS', () => {
  assert.equal(safeExternalUrl('https://canvas.example/assignment/1'), 'https://canvas.example/assignment/1');
  assert.equal(safeExternalUrl('http://localhost:3000/task'), 'http://localhost:3000/task');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeExternalUrl('//attacker.example/path'), null);
  assert.equal(safeExternalUrl('not a URL'), null);
});
