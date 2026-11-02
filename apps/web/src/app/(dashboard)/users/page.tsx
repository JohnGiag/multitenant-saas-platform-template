import type { CursorPage, Invitation, User } from '@repo/shared-types';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Pager } from '@/components/pager';
import { RoleSelect } from '@/components/choice-select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { getT, pageTitle } from '@/lib/i18n';
import { getTestMode } from '@/lib/session';
import { changeRole, invite, removeMember, resendInvitation, revokeInvitation } from './actions';

export const generateMetadata = pageTitle('nav.users');

const PAGE_SIZE = 50;

export default async function UsersPage({ searchParams }: PageProps<'/users'>) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  if (me.role === 'User' || (await getTestMode())) notFound();
  const canManage = me.role !== 'Auditor';
  // Each list pages on its own keyset cursor: ?members=<cursor>&invites=<cursor>.
  const params = await searchParams;
  const cursor = (key: string) => (typeof params[key] === 'string' ? params[key] : undefined);
  const query = (c: string | undefined) => new URLSearchParams({ limit: String(PAGE_SIZE), ...(c && { cursor: c }) });
  // Clerk mode: members join and leave through Clerk (the API answers 409 to invitations and removals).
  const [members, invitations] = await Promise.all([
    api<CursorPage<User>>(`/users?${query(cursor('members'))}`),
    CLERK ? null : api<CursorPage<Invitation>>(`/invitations?${query(cursor('invites'))}`),
  ]);
  // Moves one list to `value` (null: its first page) and keeps the other where it is.
  const pageLink = (key: 'members' | 'invites', value: string | null) => {
    const next = new URLSearchParams();
    for (const k of ['members', 'invites'] as const) {
      const v = k === key ? value : cursor(k);
      if (v) next.set(k, v);
    }
    return next.size ? `/users?${next}` : '/users';
  };

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.users')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('users.members')}</h2>
          </CardTitle>
          <CardDescription>
            {CLERK ? t('users.membersClerk') : t('users.membersLocal')}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{t('users.membersCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('common.email')}</TableHead>
                <TableHead scope="col">{t('common.role')}</TableHead>
                <TableHead scope="col">{t('users.joined')}</TableHead>
                {canManage && <TableHead scope="col">{t('common.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    {canManage && u.role !== 'SuperAdmin' ? (
                      <ActionForm action={changeRole.bind(null, u.id)} submitLabel={t('common.save')} variant="outline" size="sm" className="flex flex-wrap items-center gap-2">
                        <RoleSelect label={t('users.roleOf', { email: u.email })} defaultValue={u.role} />
                      </ActionForm>
                    ) : (
                      u.role
                    )}
                  </TableCell>
                  <TableCell>
                    <time dateTime={u.createdAt}>{u.createdAt.slice(0, 10)}</time>
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {!CLERK && u.role !== 'SuperAdmin' && u.id !== me.id && (
                        <ActionForm
                          action={removeMember.bind(null, u.id)}
                          submitLabel={t('common.remove')}
                          variant="destructive"
                          size="sm"
                          confirm={t('users.removeConfirm', { email: u.email })}
                          className="flex items-center gap-2"
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager next={members.nextCursor && pageLink('members', members.nextCursor)} first={cursor('members') && pageLink('members', null)} label={t('users.members')} />
        </CardContent>
      </Card>

      {invitations && (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('users.invitations')}</h2>
          </CardTitle>
          <CardDescription>{t('users.invitationsText')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {canManage && (
            <ActionForm action={invite} submitLabel={t('users.sendInvitation')} className="sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="invite-email" name="email" label={t('common.email')} type="email" required autoComplete="off" />
              <div className="grid gap-2">
                <Label htmlFor="invite-role">{t('common.role')}</Label>
                <RoleSelect id="invite-role" />
              </div>
            </ActionForm>
          )}
          {invitations.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('users.noInvitations')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">{t('users.invitationsCaption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('common.email')}</TableHead>
                    <TableHead scope="col">{t('common.role')}</TableHead>
                    <TableHead scope="col">{t('users.expires')}</TableHead>
                    {canManage && <TableHead scope="col">{t('common.actions')}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.email}</TableCell>
                      <TableCell>{i.role}</TableCell>
                      <TableCell>
                        <time dateTime={i.expiresAt}>{i.expiresAt.slice(0, 10)}</time>
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <ActionForm action={resendInvitation.bind(null, i.id)} submitLabel={t('users.resend')} variant="outline" size="sm" className="flex items-center gap-2" />
                            <ActionForm
                              action={revokeInvitation.bind(null, i.id)}
                              submitLabel={t('common.revoke')}
                              variant="destructive"
                              size="sm"
                              confirm={t('users.revokeConfirm', { email: i.email })}
                              className="flex items-center gap-2"
                            />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager next={invitations.nextCursor && pageLink('invites', invitations.nextCursor)} first={cursor('invites') && pageLink('invites', null)} label={t('users.invitations')} />
        </CardContent>
      </Card>
      )}
    </div>
  );
}
