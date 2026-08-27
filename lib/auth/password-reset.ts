export const RESET_PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RECOVERY_PATH = '/auth/reset-password';
export const PASSWORD_RECOVERY_API_PATH = '/api/auth/password-recovery';
export const PASSWORD_RECOVERY_COOKIE = 'orderly-password-recovery';
export const PASSWORD_RECOVERY_MAX_AGE_SECONDS = 15 * 60;

export function isPasswordRecoveryExchange(
  destination: string,
  redirectType: string | null | undefined,
): boolean {
  return destination === PASSWORD_RECOVERY_PATH && redirectType === 'recovery';
}

export function validateResetPassword(password: string, confirmation: string): string | null {
  if (password.length < RESET_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${RESET_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirmation) {
    return 'Passwords do not match.';
  }
  return null;
}
