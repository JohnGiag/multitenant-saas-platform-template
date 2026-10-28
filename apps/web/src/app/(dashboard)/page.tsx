import type { Metadata } from 'next';
import { Gauge, Puzzle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCapabilities, getCurrentTenant, getPrincipal } from '@/lib/api';
import { capabilityTitle } from '@/lib/capabilities';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const [me, tenant, capabilities] = await Promise.all([getPrincipal(), getCurrentTenant(), getCapabilities()]);
  const stats = [
    { label: 'Tier', value: tenant.tier, icon: Gauge },
    { label: 'Your role', value: me.role, icon: ShieldCheck },
    { label: 'Features enabled', value: `${capabilities.filter((c) => c.enabled).length} of ${capabilities.length}`, icon: Puzzle },
  ];
  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{tenant.name}</h2>
        <p className="text-sm text-muted-foreground">
          Tenant ID <span className="font-mono break-all">{tenant.id}</span>
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <li key={label}>
            <Card className="flex-row items-center gap-4 px-6 py-5">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                <Icon className="size-5" />
              </span>
              <div className="grid gap-0.5">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold first-letter:uppercase">{value}</p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
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
            <ul className="divide-y">
              {capabilities.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0">
                  <span className="font-medium">{capabilityTitle(c.key)}</span>
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
