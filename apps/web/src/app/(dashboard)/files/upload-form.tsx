'use client';

import { MAX_UPLOAD_BYTES } from '@repo/shared-types';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createUpload } from './actions';

export function UploadForm() {
  const router = useRouter();
  const [status, setStatus] = useState<{ error?: boolean; text: string }>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return setStatus({ error: true, text: 'Choose a file first.' });
    if (file.size > MAX_UPLOAD_BYTES) return setStatus({ error: true, text: 'Files can be at most 1 MB.' });
    setPending(true);
    setStatus({ text: `Uploading ${file.name}…` });
    try {
      const presigned = await createUpload(file.name, file.size);
      if ('error' in presigned) return setStatus({ error: true, text: presigned.error });
      // The URL only accepts exactly file.size bytes, which is what fetch sends for a File body.
      const res = await fetch(presigned.url, { method: 'PUT', body: file });
      if (!res.ok) return setStatus({ error: true, text: `The bucket refused the upload (${res.status}).` });
      setStatus({ text: `Uploaded ${file.name}.` });
      form.reset();
      router.refresh();
    } catch {
      // Usually a missing CORS rule on the bucket: the browser blocks the request before it is sent.
      setStatus({ error: true, text: 'The upload could not reach the bucket. Check its CORS rule allows this dashboard.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" aria-busy={pending}>
      <div className="grid gap-2">
        <Label htmlFor="file">File</Label>
        <Input id="file" name="file" type="file" required aria-describedby="file-hint" />
        <p id="file-hint" className="text-sm text-muted-foreground">
          Up to 1 MB.
        </p>
      </div>
      <p aria-live="polite" className={status?.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {status?.text}
      </p>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? 'Uploading…' : 'Upload'}
      </Button>
    </form>
  );
}
