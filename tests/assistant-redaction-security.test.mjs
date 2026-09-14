import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantDataMessage, assistantProviderBody, redactAssistantSecrets } from '../lib/planner/assistant-provider.ts';

// Deliberately assembled synthetic markers, never valid provider credentials.
const markers = [
  ['sk', 'test'].join('_') + '_' + 'X'.repeat(32),
  ['sk', 'live'].join('_') + '_' + 'X'.repeat(32),
  ['rk', 'live'].join('_') + '_' + 'X'.repeat(32),
  'whsec_' + 'X'.repeat(32),
  'sb_secret_' + 'X'.repeat(32),
  'sk-' + 'X'.repeat(32),
];

test('accidentally pasted provider, database and payment secrets are removed before AI transmission', () => {
  for (const marker of markers) {
    const text = `Please plan my day ${marker}`;
    const redacted = redactAssistantSecrets(text);
    assert.ok(!redacted.includes(marker));
    assert.match(redacted, /Please plan my day/);
    const body = assistantProviderBody('fixture', [{ role: 'user', content: text }], 1800);
    assert.ok(!body.includes(marker));
  }
});

test('credential-shaped fields are excluded at every depth without dropping legitimate task fields', () => {
  const keys = ['stripe_secret_key', 'STRIPE_WEBHOOK_SECRET', 'DEEPSEEK_API_KEY', 'apiKey', 'secretKey', 'password', 'service_role_key'];
  const nested = Object.fromEntries(keys.map(key => [key, 'sensitive-fixture-value']));
  const result = assistantDataMessage('Fixture', { title: 'Math homework', description: 'Read chapter 4', nested: [nested] });
  assert.doesNotMatch(result.content, /sensitive-fixture-value/);
  assert.match(result.content, /Math homework/);
  assert.match(result.content, /Read chapter 4/);
});

test('ordinary assignment URLs and words remain useful after redaction', () => {
  const text = 'Read https://school.instructure.com/courses/42/assignments/8 and explain secret key cryptography.';
  assert.equal(redactAssistantSecrets(text), text);
});
