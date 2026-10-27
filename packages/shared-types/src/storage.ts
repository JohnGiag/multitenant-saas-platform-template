import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { pageQuery } from './pagination.js';

// Largest file one upload URL accepts: the size is signed into the URL, so the store refuses anything else.
export const MAX_UPLOAD_BYTES = 1024 * 1024;

// Becomes one segment of the object key, so no slashes, control characters, "." or "..".
const FilenameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/, 'Must not contain slashes or control characters')
  .refine((name) => name !== '.' && name !== '..', 'Must not be "." or ".."');

export const CreateUploadSchema = z.object({
  filename: FilenameSchema,
  // Exact size in bytes: the upload must send exactly this Content-Length.
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});
export type CreateUploadDto = z.infer<typeof CreateUploadSchema>;

// ?key= on downloads and deletions: a key returned by an earlier upload, "<tenantId>/...".
export const StorageKeyQuerySchema = z.object({
  // S3 keys are at most 1024 bytes.
  key: z.string().min(1).max(1024),
});
export type StorageKeyQuery = z.infer<typeof StorageKeyQuerySchema>;

export const PresignedDownloadSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type PresignedDownload = z.infer<typeof PresignedDownloadSchema>;

export const PresignedUploadSchema = PresignedDownloadSchema.extend({
  // Keep it: downloads ask for the file by this key.
  key: z.string(),
});
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;

// A file in the platform bucket, newest first (GET /v1/storage/objects). Files in a tenant's own bucket are
// not tracked, so they are not listed. `size` was reserved when the upload URL was issued, whether or not
// the file was then sent.
export const StoredFileSchema = z.object({
  id: IdSchema,
  key: z.string(),
  filename: z.string(),
  size: z.number().int(),
  uploaderId: IdSchema,
  createdAt: TimestampSchema,
});
export type StoredFile = z.infer<typeof StoredFileSchema>;

export const StoredFilePageQuerySchema = pageQuery(IdSchema);
export type StoredFilePageQuery = z.infer<typeof StoredFilePageQuerySchema>;
