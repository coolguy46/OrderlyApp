import { createHash } from 'node:crypto';

const email = 'approved-owner@example.invalid';
export const verifiedOwner = {
  id: '27f1349b-68f6-4e40-8952-489a391e3e03', email,
  email_confirmed_at: '2026-01-01T00:00:00Z',
  identities: [{ provider: 'google', identity_data: { email, email_verified: true } }],
};

// Replace only the allowlisted fingerprint inside the isolated test loader.
// Never use a real person's email, session or credentials in a test.
export const withTestOwner = source => source.replace(/const OWNER_EMAIL_HASH = '[a-f0-9]{64}'/,
  `const OWNER_EMAIL_HASH = '${createHash('sha256').update(email).digest('hex')}'`);

export const rejectedOwners = [
  { ...verifiedOwner, id: '' },
  { ...verifiedOwner, email_confirmed_at: null },
  { ...verifiedOwner, email: 'other@example.invalid' },
  { ...verifiedOwner, identities: [] },
  { ...verifiedOwner, identities: [{ provider: 'email', identity_data: { email, email_verified: true } }] },
  { ...verifiedOwner, identities: [{ provider: 'google', identity_data: { email, email_verified: false } }] },
  { ...verifiedOwner, identities: [{ provider: 'google', identity_data: { email, email_verified: 'true' } }] },
  { ...verifiedOwner, identities: [{ provider: 'google', identity_data: { email: 'other@example.invalid', email_verified: true } }] },
  { ...verifiedOwner, email: 'other@example.invalid', identities: [], user_metadata: {
    ...verifiedOwner, email_verified: true, provider: 'google', ownerAccess: true, admin: true,
  } },
];
