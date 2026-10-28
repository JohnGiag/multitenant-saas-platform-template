'use client';

import type { Notification } from '@repo/shared-types';
import { useEffect, useState } from 'react';
import { useT } from '@/components/i18n-provider';

// Message keys.
const STATUS = {
  connecting: 'notifications.connecting',
  live: 'notifications.live',
  offline: 'notifications.offline',
  closed: 'notifications.closed',
} as const;

const MAX_ITEMS = 50;

// The caller's own notifications as they arrive. Kept in memory only: the API does not store them.
export function NotificationFeed() {
  const t = useT();
  const [items, setItems] = useState<(Notification & { receivedAt: string })[]>([]);
  const [status, setStatus] = useState<keyof typeof STATUS>('connecting');

  useEffect(() => {
    const source = new EventSource('/notifications/stream');
    source.onopen = () => setStatus('live');
    source.addEventListener('notification', (e) => {
      const notification = JSON.parse(e.data) as Notification;
      setItems((prev) => [{ ...notification, receivedAt: new Date().toISOString() }, ...prev].slice(0, MAX_ITEMS));
    });
    // The server replaced this stream with a newer one: reconnecting would only start a fight between tabs.
    source.addEventListener('closed', () => {
      source.close();
      setStatus('closed');
    });
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    return () => source.close();
  }, []);

  return (
    <div className="grid gap-4">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {t(STATUS[status])}
      </p>
      {/* role="log": screen readers announce new entries as they are added. */}
      <div role="log" aria-label={t('notifications.received')}>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('notifications.none')}</p>
        ) : (
          <ul className="grid gap-3">
            {items.map((n, i) => (
              <li key={`${n.receivedAt}-${i}`} className="rounded-md border p-3">
                <p className="font-medium">{n.title}</p>
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                <time dateTime={n.receivedAt} className="text-xs text-muted-foreground">
                  {new Date(n.receivedAt).toLocaleTimeString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
