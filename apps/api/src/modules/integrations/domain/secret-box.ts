import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM. Stored layout: version (1 byte) | IV (12) | auth tag (16) | ciphertext.
// `context` (e.g. "<tenantId>/<provider>") is bound as additional authenticated data, so a
// ciphertext copied to another tenant or provider fails to decrypt.
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export function parseMasterKey(base64: string): Uint8Array {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('BYOK_MASTER_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function sealSecret(key: Uint8Array, plaintext: string, context: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), ciphertext]));
}

// Throws if the blob was tampered with, moved to another context, or sealed with another key.
export function openSecret(key: Uint8Array, sealed: Uint8Array, context: string): string {
  if (sealed.length < HEADER_BYTES || sealed[0] !== VERSION) throw new Error('Unsupported secret format');
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(HEADER_BYTES)), decipher.final()]).toString('utf8');
}
