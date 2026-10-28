import type { CursorPage, User } from '@repo/shared-types';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, getPrincipal } from '@/lib/api';
import { getT, pageTitle } from '@/lib/i18n';
import { sendNotification } from './actions';
import { NotificationFeed } from './notification-feed';

export const generateMetadata = pageTitle('nav.notifications');

export default async function NotificationsPage() {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  // Sending is a tenant's own admins' business (SuperAdmin stays out of tenant messaging); everyone has a feed.
  const canSend = me.role === 'TenantAdmin';
  // shortcut: offers the first 100 members as recipients; add a searchable picker for larger tenants.
  const members = canSend ? (await api<CursorPage<User>>('/users?limit=100')).items : [];

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.notifications')}</h1>
      {canSend && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('notifications.sendTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('notifications.sendText')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={sendNotification} submitLabel={t('notifications.send')}>
              <div className="grid gap-2">
                <Label htmlFor="recipient">{t('notifications.recipient')}</Label>
                <Select name="userId" defaultValue={me.id} required>
                  <SelectTrigger id="recipient" className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.email}
                        {u.id === me.id && ` ${t('notifications.you')}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field id="notification-title" name="title" label={t('notifications.title')} required maxLength={200} autoComplete="off" />
              <Field id="notification-body" name="body" label={t('notifications.message')} multiline rows={4} required maxLength={2000} />
            </ActionForm>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('notifications.yours')}</h2>
          </CardTitle>
          <CardDescription>{t('notifications.yoursText')}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationFeed />
        </CardContent>
      </Card>
    </div>
  );
}
