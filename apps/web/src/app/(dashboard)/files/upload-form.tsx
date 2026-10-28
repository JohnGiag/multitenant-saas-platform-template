'use client';

import { MAX_UPLOAD_BYTES } from '@repo/shared-types';
import { FileCheck, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatSize } from '@/lib/format-size';
import { createUpload } from './actions';

export function UploadForm() {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<{ error?: boolean; text: string }>();
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState<File>();
  const [dragging, setDragging] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return setStatus({ error: true, text: t('files.chooseFirst') });
    if (file.size > MAX_UPLOAD_BYTES) return setStatus({ error: true, text: t('files.tooBig') });
    setPending(true);
    setStatus({ text: t('files.uploading', { name: file.name }) });
    try {
      const presigned = await createUpload(file.name, file.size);
      if ('error' in presigned) return setStatus({ error: true, text: presigned.error });
      // The URL only accepts exactly file.size bytes, which is what fetch sends for a File body.
      const res = await fetch(presigned.url, { method: 'PUT', body: file });
      if (!res.ok) return setStatus({ error: true, text: t('files.refused', { status: res.status }) });
      setStatus({ text: t('files.uploadedFile', { name: file.name }) });
      form.reset();
      router.refresh();
    } catch {
      // Usually a missing CORS rule on the bucket: the browser blocks the request before it is sent.
      setStatus({ error: true, text: t('files.unreachable') });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} onReset={() => setChosen(undefined)} className="grid gap-4" aria-busy={pending}>
      {/* The real input covers the whole zone (invisible), so clicks, drops, keyboard and screen readers all use it. */}
      <div
        data-dragging={dragging || undefined}
        className="relative grid justify-items-center gap-3 rounded-xl border-2 border-dashed border-input px-6 py-10 text-center transition-colors hover:border-primary hover:bg-accent/50 has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring data-dragging:border-primary data-dragging:bg-accent"
      >
        <span aria-hidden className="grid size-12 place-items-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground">
          {chosen ? <FileCheck className="size-6" /> : <Upload className="size-6" />}
        </span>
        <Label htmlFor="file" className="text-base">
          {chosen ? t('files.chooseAnother') : t('files.dropHere')}
        </Label>
        <p id="file-hint" className="text-sm text-muted-foreground">
          {chosen ? `${chosen.name} · ${formatSize(chosen.size)}` : t('files.anyFile')}
        </p>
        <input
          id="file"
          name="file"
          type="file"
          required
          aria-describedby="file-hint"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          onChange={(e) => setChosen(e.currentTarget.files?.[0])}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={() => setDragging(false)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className={status?.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {status?.text}
        </p>
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? t('files.uploadingButton') : t('files.upload')}
        </Button>
      </div>
    </form>
  );
}
