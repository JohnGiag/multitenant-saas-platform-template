export const PASSWORD_RESET_SERVICE = Symbol('PasswordResetService');

export interface PasswordResetService {
  // Emails a reset link when the account exists and has a local password; otherwise does nothing.
  // Callers must not reveal which happened.
  request(tenantId: string, email: string): Promise<void>;
  // 'invalid': unknown, used or expired token.
  confirm(token: string, password: string): Promise<{ tenantId: string; email: string } | 'invalid'>;
}
