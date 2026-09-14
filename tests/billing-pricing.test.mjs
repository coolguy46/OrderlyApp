import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ORDERLY_AI_MONTHLY_PRICE_CENTS, ORDERLY_AI_MONTHLY_PRICE_LABEL } from '../lib/billing/plan.ts';

test('approved monthly price is $8.99 and shared by customer copy and server validation', async () => {
  assert.equal(ORDERLY_AI_MONTHLY_PRICE_CENTS, 899);
  assert.equal(ORDERLY_AI_MONTHLY_PRICE_LABEL, '$8.99');
  for (const file of ['components/billing/BillingDetails.tsx', 'app/terms/page.tsx', 'lib/billing/service.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes('ORDERLY_AI_MONTHLY_PRICE_LABEL'), file);
    assert.ok(!source.includes('$4.99'), `${file} must not advertise the retired price`);
  }
});
