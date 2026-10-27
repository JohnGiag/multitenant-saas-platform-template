import type { CursorPage, User } from '@repo/shared-types';
import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, getPrincipal } from '@/lib/api';
import { sendNotification } from './actions';
import { NotificationFeed } from './notification-feed';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const me = await getPrincipal();
  // Sending is a tenant's own admins' business (SuperAdmin stays out of tenant messaging); everyone has a feed.
  const canSend = me.role === 'TenantAdmin';
  // shortcut: offers the first 100 members as recipients; add a searchable picker for larger tenants.
  const members = canSend ? (await api<CursorPage<User>>('/users?limit=100')).items : [];

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      {canSend && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Send a notification</h2>
            </CardTitle>
            <CardDescription>Delivered in real time to the recipient&apos;s open dashboards, and by email and push where this tenant has set them up.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={sendNotification} submitLabel="Send">
              <div className="grid gap-2">
                <Label htmlFor="recipient">Recipient</Label>
                <Select name="userId" defaultValue={me.id} required>
                  <SelectTrigger id="recipient" className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.email}
                        {u.id === me.id && ' (you)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field id="notification-title" name="title" label="Title" required maxLength={200} autoComplete="off" />
              <Field id="notification-body" name="body" label="Message" multiline rows={4} required maxLength={2000} />
            </ActionForm>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Your notifications</h2>
          </CardTitle>
          <CardDescription>Only those that arrive while this page is open: the API does not keep a history.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationFeed />
        </CardContent>
      </Card>
    </div>
  );
}
