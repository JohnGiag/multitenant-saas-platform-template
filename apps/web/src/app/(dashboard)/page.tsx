import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCapabilities, getCurrentTenant, getPrincipal } from '@/lib/api';
import { capabilityTitle } from '@/lib/capabilities';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const [me, tenant, capabilities] = await Promise.all([getPrincipal(), getCurrentTenant(), getCapabilities()]);
  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{tenant.name}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Tenant ID</dt>
            <dd className="font-mono break-all">{tenant.id}</dd>
            <dt className="text-muted-foreground">Tier</dt>
            <dd className="capitalize">{tenant.tier}</dd>
            <dt className="text-muted-foreground">Your role</dt>
            <dd>{me.role}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Features</h2>
          </CardTitle>
          <CardDescription>Optional modules installed on this platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {capabilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No optional modules are installed.</p>
          ) : (
            <ul className="grid gap-2">
              {capabilities.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-4 text-sm">
                  <span>{capabilityTitle(c.key)}</span>
                  <Badge variant={c.enabled ? 'default' : 'outline'}>{c.enabled ? 'Enabled' : 'Not configured'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
