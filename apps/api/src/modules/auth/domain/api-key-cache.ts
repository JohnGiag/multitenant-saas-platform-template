import type { Principal } from '@repo/shared-types';

// How long a revoked key can keep working if Redis, which carries revocations, is down. Also how stale a tier can be.
export const API_KEY_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

// Never the secret: every request still compares it with the hash, in constant time.
export interface CachedApiKey {
  principal: Principal;
  secretHash: Uint8Array;
  loadedAtMs: number;
}

// Verified keys in this instance, by prefix. A Map keeps insertion order, so its first key is the least recently used.
export class ApiKeyCache {
  private readonly entries = new Map<string, CachedApiKey>();

  get(prefix: string, now = Date.now()): CachedApiKey | undefined {
    const entry = this.entries.get(prefix);
    if (!entry) return undefined;
    this.entries.delete(prefix);
    if (now - entry.loadedAtMs >= API_KEY_CACHE_TTL_MS) return undefined;
    this.entries.set(prefix, entry);
    return entry;
  }

  set(prefix: string, entry: CachedApiKey): void {
    this.entries.delete(prefix);
    this.entries.set(prefix, entry);
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }
}
