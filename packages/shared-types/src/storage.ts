import { z } from 'zod';

// Becomes one segment of the object key, so no slashes, control characters, "." or "..".
const FilenameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/, 'Must not contain slashes or control characters')
  .refine((name) => name !== '.' && name !== '..', 'Must not be "." or ".."');

export const CreateUploadSchema = z.object({ filename: FilenameSchema });
export type CreateUploadDto = z.infer<typeof CreateUploadSchema>;

export const CreateDownloadSchema = z.object({
  // A key returned by an earlier upload: "<tenantId>/...". S3 keys are at most 1024 bytes.
  key: z.string().min(1).max(1024),
});
export type CreateDownloadDto = z.infer<typeof CreateDownloadSchema>;

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
