import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PASSWORD_RECOVERY_MAX_AGE_SECONDS } from './password-reset.ts';

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 16_384;
const CLOCK_SKEW_SECONDS = 60;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const TOKEN_AAD = Buffer.from('orderly-password-recovery:v1');

interface RecoverySessionPayload {
  v: typeof TOKEN_VERSION;
  sub: string;
  iat: number;
  exp: number;
  nonce: string;
  accessToken: string;
  refreshToken: string;
  userVersion: string;
}

export interface RecoverySessionIdentity {
  userId: string;
  accessToken: string;
  refreshToken: string;
  userVersion: string;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function isPayload(value: unknown): value is RecoverySessionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<RecoverySessionPayload>;
  return payload.v === TOKEN_VERSION
    && typeof payload.sub === 'string'
    && Number.isSafeInteger(payload.iat)
    && Number.isSafeInteger(payload.exp)
    && typeof payload.nonce === 'string'
    && payload.nonce.length >= 16
    && typeof payload.accessToken === 'string'
    && payload.accessToken.length > 0
    && typeof payload.refreshToken === 'string'
    && payload.refreshToken.length > 0
    && typeof payload.userVersion === 'string';
}

/**
 * Recovery authorization is an encrypted, authenticated capability. The
 * Supabase recovery session lives only inside an HttpOnly cookie scoped to
 * the password-recovery endpoint, so it cannot act as an ordinary Orderly
 * login while the user is choosing a new password.
 */
export function createPasswordRecoverySessionToken(
  identity: RecoverySessionIdentity,
  secret: string,
  nowMs = Date.now(),
): string {
  if (secret.length < 32) throw new Error('Password recovery signing secret is not configured');
  const issuedAt = Math.floor(nowMs / 1_000);
  const payload: RecoverySessionPayload = {
    v: TOKEN_VERSION,
    sub: identity.userId,
    iat: issuedAt,
    exp: issuedAt + PASSWORD_RECOVERY_MAX_AGE_SECONDS,
    nonce: randomBytes(18).toString('base64url'),
    accessToken: identity.accessToken,
    refreshToken: identity.refreshToken,
    userVersion: identity.userVersion,
  };
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  cipher.setAAD(TOKEN_AAD);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [TOKEN_VERSION, encode(iv), encode(encrypted), encode(cipher.getAuthTag())].join('.');
}

export function readPasswordRecoverySessionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): RecoverySessionIdentity | null {
  if (!token || token.length > MAX_TOKEN_LENGTH || secret.length < 32) return null;
  const [version, encodedIv, encodedPayload, encodedAuthTag, extra] = token.split('.');
  if (version !== String(TOKEN_VERSION) || !encodedIv || !encodedPayload || !encodedAuthTag || extra) {
    return null;
  }

  let payload: unknown;
  try {
    const iv = Buffer.from(encodedIv, 'base64url');
    const encrypted = Buffer.from(encodedPayload, 'base64url');
    const authTag = Buffer.from(encodedAuthTag, 'base64url');
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || encrypted.length === 0) {
      return null;
    }
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(authTag);
    payload = JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8'));
  } catch {
    return null;
  }

  if (!isPayload(payload)) return null;

  const now = Math.floor(nowMs / 1_000);
  if (!(payload.iat <= now + CLOCK_SKEW_SECONDS
    && payload.exp >= now
    && payload.exp - payload.iat === PASSWORD_RECOVERY_MAX_AGE_SECONDS)) {
    return null;
  }
  return {
    userId: payload.sub,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    userVersion: payload.userVersion,
  };
}

export function getPasswordRecoverySigningSecret(): string | null {
  const secret = process.env.PASSWORD_RECOVERY_SIGNING_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || '';
  return secret.length >= 32 ? secret : null;
}
