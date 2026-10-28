'use server';

import { CreateUploadSchema, StorageKeyQuerySchema, type PresignedDownload, type PresignedUpload } from '@repo/shared-types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, apiFailure } from '@/lib/api';
import { invalid, type FormState } from '@/lib/form-state';
import { getT } from '@/lib/i18n';

// Only the URL comes back: the browser PUTs the file straight to the bucket, so the bytes never pass through
// the dashboard or the API.
export async function createUpload(filename: string, size: number): Promise<{ url: string } | { error: string }> {
  const parsed = CreateUploadSchema.safeParse({ filename, size });
  if (!parsed.success) return { error: invalid(parsed.error)?.error ?? (await getT())('files.invalid') };
  try {
    const { url } = await api<PresignedUpload>('/storage/uploads', { method: 'POST', body: parsed.data });
    return { url };
  } catch (error) {
    return { error: apiFailure(error)?.error ?? (await getT())('files.failed') };
  }
}

export async function downloadFile(key: string): Promise<FormState> {
  let url: string;
  try {
    ({ url } = await api<PresignedDownload>(`/storage/downloads?${new URLSearchParams(StorageKeyQuerySchema.parse({ key }))}`));
  } catch (error) {
    return apiFailure(error);
  }
  redirect(url);
}

export async function deleteFile(key: string): Promise<FormState> {
  try {
    await api(`/storage/objects?${new URLSearchParams(StorageKeyQuerySchema.parse({ key }))}`, { method: 'DELETE' });
  } catch (error) {
    return apiFailure(error);
  }
  revalidatePath('/files');
  return { success: (await getT())('files.deleted') };
}
