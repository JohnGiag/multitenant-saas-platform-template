export const ACCESS_REVOCATIONS = Symbol('AccessRevocations');

export type RevocationScope = 'tenant' | 'user' | 'session' | 'apiKey';

// Access tokens are stateless, so this is what makes a change apply before they expire: every token issued before
// a revocation of its tenant, user or session stops working at once. Holders with a live session just refresh.
// Cached API keys work the same way: one read before a revocation of its tenant or key is read again.
export interface AccessRevocations {
  // Called after the change committed: reports a failure rather than throwing it.
  revoke(scope: RevocationScope, id: string): Promise<void>;
  isRevoked(token: { tenantId: string; userId: string; sessionId: string; issuedAtMs: number }): Promise<boolean>;
  isKeyRevoked(key: { tenantId: string; apiKeyId: string; loadedAtMs: number }): Promise<boolean>;
}
