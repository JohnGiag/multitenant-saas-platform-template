import type { CursorPage, Invitation, User } from '@repo/shared-types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Pager } from '@/components/pager';
import { RoleSelect } from '@/components/role-select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, getPrincipal } from '@/lib/api';
import { changeRole, invite, removeMember, resendInvitation, revokeInvitation } from './actions';

export const metadata: Metadata = { title: 'Users' };

const PAGE_SIZE = 50;

export default async function UsersPage({ searchParams }: PageProps<'/users'>) {
  const me = await getPrincipal();
  if (me.role === 'User') notFound();
  const canManage = me.role !== 'Auditor';
  // Each list pages on its own keyset cursor: ?members=<cursor>&invites=<cursor>.
  const params = await searchParams;
  const cursor = (key: string) => (typeof params[key] === 'string' ? params[key] : undefined);
  const query = (c: string | undefined) => new URLSearchParams({ limit: String(PAGE_SIZE), ...(c && { cursor: c }) });
  const [members, invitations] = await Promise.all([
    api<CursorPage<User>>(`/users?${query(cursor('members'))}`),
    api<CursorPage<Invitation>>(`/invitations?${query(cursor('invites'))}`),
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
      <h1 className="text-2xl font-semibold">Users</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Members</h2>
          </CardTitle>
          <CardDescription>Role changes take effect when the member&apos;s current session expires (at most 15 minutes).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">Members of this tenant</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Email</TableHead>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col">Joined</TableHead>
                {canManage && <TableHead scope="col">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    {canManage && u.role !== 'SuperAdmin' ? (
                      <ActionForm action={changeRole.bind(null, u.id)} submitLabel="Save" variant="outline" size="sm" className="flex flex-wrap items-center gap-2">
                        <RoleSelect label={`Role of ${u.email}`} defaultValue={u.role} />
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
                      {u.role !== 'SuperAdmin' && u.id !== me.id && (
                        <ActionForm
                          action={removeMember.bind(null, u.id)}
                          submitLabel="Remove"
                          variant="destructive"
                          size="sm"
                          confirm={`Remove ${u.email}? Their account is deleted.`}
                          className="flex items-center gap-2"
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager next={members.nextCursor && pageLink('members', members.nextCursor)} first={cursor('members') && pageLink('members', null)} label="members" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invitations</h2>
          </CardTitle>
          <CardDescription>New members join by invitation and choose their own password. Links are valid for 7 days.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {canManage && (
            <ActionForm action={invite} submitLabel="Send invitation" className="sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="invite-email" name="email" label="Email" type="email" required autoComplete="off" />
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <RoleSelect id="invite-role" />
              </div>
            </ActionForm>
          )}
          {invitations.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invitations.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">Pending invitations</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Email</TableHead>
                    <TableHead scope="col">Role</TableHead>
                    <TableHead scope="col">Expires</TableHead>
                    {canManage && <TableHead scope="col">Actions</TableHead>}
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
                            <ActionForm action={resendInvitation.bind(null, i.id)} submitLabel="Resend" variant="outline" size="sm" className="flex items-center gap-2" />
                            <ActionForm
                              action={revokeInvitation.bind(null, i.id)}
                              submitLabel="Revoke"
                              variant="destructive"
                              size="sm"
                              confirm={`Revoke the invitation for ${i.email}?`}
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
          <Pager next={invitations.nextCursor && pageLink('invites', invitations.nextCursor)} first={cursor('invites') && pageLink('invites', null)} label="invitations" />
        </CardContent>
      </Card>
    </div>
  );
}
