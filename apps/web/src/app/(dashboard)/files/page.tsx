import type { CursorPage, StoredFile } from '@repo/shared-types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Pager } from '@/components/pager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getCapabilities, getPrincipal } from '@/lib/api';
import { formatSize } from '@/lib/format-size';
import { deleteFile, downloadFile } from './actions';
import { UploadForm } from './upload-form';

export const metadata: Metadata = { title: 'Files' };

const PAGE_SIZE = 50;

export default async function FilesPage({ searchParams }: PageProps<'/files'>) {
  const me = await getPrincipal();
  // Tenant business data (SuperAdmin stays out), and only while the storage module is installed and usable.
  if (me.role === 'SuperAdmin' || !(await getCapabilities()).some((c) => c.key === 'storage' && c.enabled)) notFound();
  const canWrite = me.role !== 'Auditor';
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const files = await api<CursorPage<StoredFile>>(`/storage/objects?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`);

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">Files</h1>
      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Upload a file</h2>
            </CardTitle>
            <CardDescription>The file goes straight from your browser to the storage bucket.</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Files</h2>
          </CardTitle>
          <CardDescription>
            Files in the platform bucket, newest first (up to 100 MB and 1,000 files per tenant). If this tenant uses its own bucket, files
            there are managed with the bucket&apos;s own tools and are not listed.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {files.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">Files of this tenant</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Size</TableHead>
                  <TableHead scope="col">Uploaded</TableHead>
                  <TableHead scope="col">By</TableHead>
                  <TableHead scope="col">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.items.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.filename}</TableCell>
                    <TableCell>{formatSize(f.size)}</TableCell>
                    <TableCell>
                      <time dateTime={f.createdAt}>{f.createdAt.slice(0, 10)}</time>
                    </TableCell>
                    <TableCell>{f.uploaderId === me.id ? 'You' : 'Someone else'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <ActionForm action={downloadFile.bind(null, f.key)} submitLabel="Download" variant="outline" size="sm" className="flex items-center gap-2" />
                        {/* The API lets only the uploader or a TenantAdmin delete. */}
                        {canWrite && (me.role === 'TenantAdmin' || f.uploaderId === me.id) && (
                          <ActionForm
                            action={deleteFile.bind(null, f.key)}
                            submitLabel="Delete"
                            variant="destructive"
                            size="sm"
                            confirm={`Delete ${f.filename}? This cannot be undone.`}
                            className="flex items-center gap-2"
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager next={files.nextCursor && `/files?${new URLSearchParams({ cursor: files.nextCursor })}`} first={current && '/files'} label="files" />
        </CardContent>
      </Card>
    </div>
  );
}
