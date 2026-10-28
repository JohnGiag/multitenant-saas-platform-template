import type { CursorPage, StoredFile } from '@repo/shared-types';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Pager } from '@/components/pager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getCapabilities, getPrincipal } from '@/lib/api';
import { formatSize } from '@/lib/format-size';
import { getT, pageTitle } from '@/lib/i18n';
import { deleteFile, downloadFile } from './actions';
import { UploadForm } from './upload-form';

export const generateMetadata = pageTitle('nav.files');

const PAGE_SIZE = 50;

export default async function FilesPage({ searchParams }: PageProps<'/files'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  // Tenant business data (SuperAdmin stays out), and only while the storage module is installed and usable.
  if (me.role === 'SuperAdmin' || !(await getCapabilities()).some((c) => c.key === 'storage' && c.enabled)) notFound();
  const canWrite = me.role !== 'Auditor';
  const { cursor } = await searchParams;
  const current = typeof cursor === 'string' ? cursor : undefined;
  const files = await api<CursorPage<StoredFile>>(`/storage/objects?${new URLSearchParams({ limit: String(PAGE_SIZE), ...(current && { cursor: current }) })}`);

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.files')}</h1>
      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('files.uploadTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('files.uploadText')}</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('nav.files')}</h2>
          </CardTitle>
          <CardDescription>{t('files.listText')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {files.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('files.none')}</p>
          ) : (
            <Table>
              <TableCaption className="sr-only">{t('files.caption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('common.name')}</TableHead>
                  <TableHead scope="col">{t('files.size')}</TableHead>
                  <TableHead scope="col">{t('files.uploaded')}</TableHead>
                  <TableHead scope="col">{t('files.by')}</TableHead>
                  <TableHead scope="col">{t('common.actions')}</TableHead>
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
                    <TableCell>{f.uploaderId === me.id ? t('common.you') : t('files.someoneElse')}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <ActionForm action={downloadFile.bind(null, f.key)} submitLabel={t('files.download')} variant="outline" size="sm" className="flex items-center gap-2" />
                        {/* The API lets only the uploader or a TenantAdmin delete. */}
                        {canWrite && (me.role === 'TenantAdmin' || f.uploaderId === me.id) && (
                          <ActionForm
                            action={deleteFile.bind(null, f.key)}
                            submitLabel={t('common.delete')}
                            variant="destructive"
                            size="sm"
                            confirm={t('files.deleteConfirm', { name: f.filename })}
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
          <Pager next={files.nextCursor && `/files?${new URLSearchParams({ cursor: files.nextCursor })}`} first={current && '/files'} label={t('nav.files')} />
        </CardContent>
      </Card>
    </div>
  );
}
