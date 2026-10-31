export const PASSWORD_RESET_SERVICE = Symbol('PasswordResetService');

export interface PasswordResetService {
  // Emails a reset link to every account with this email and a local password, in any tenant, each naming
  // its tenant; nothing when there is none. Callers must not reveal which happened.
  request(email: string): Promise<void>;
  // 'invalid': unknown, used or expired token.
  confirm(token: string, password: string): Promise<{ tenantId: string; userId: string; email: string } | 'invalid'>;
}
