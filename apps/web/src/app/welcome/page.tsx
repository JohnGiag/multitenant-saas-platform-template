import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  Container,
  CloudUpload,
  CreditCard,
  Fingerprint,
  Gauge,
  LockKeyhole,
  Puzzle,
  ScrollText,
  ShieldCheck,
  Webhook,
  Workflow,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n';
import { cn } from 'cn';

// The landing page signed-out visitors get at / (proxy.ts). Its copy describes this template: a project built on it
// replaces the welcome.* and feature.* rows in `translations` with its own product's and keeps the layout.

export const metadata: Metadata = { title: { absolute: 'Enterprise API Starter' } };

const REPO_URL = 'https://github.com/JohnGiag/multitenant-api-template';

// `title` and `text` are message keys. `wide` cards span two columns of the grid on large screens.
const FEATURES = [
  {
    icon: Building2,
    title: 'feature.multiTenant.title',
    text: 'feature.multiTenant.text',
    wide: true,
  },
  { icon: Fingerprint, title: 'feature.auth.title', text: 'feature.auth.text' },
  { icon: ShieldCheck, title: 'feature.rbac.title', text: 'feature.rbac.text' },
  { icon: LockKeyhole, title: 'feature.byok.title', text: 'feature.byok.text' },
  { icon: Gauge, title: 'feature.rateLimit.title', text: 'feature.rateLimit.text' },
  { icon: Workflow, title: 'feature.jobs.title', text: 'feature.jobs.text' },
  {
    icon: Puzzle,
    title: 'feature.modules.title',
    text: 'feature.modules.text',
    wide: true,
  },
  { icon: Bell, title: 'feature.notifications.title', text: 'feature.notifications.text' },
  { icon: ScrollText, title: 'feature.audit.title', text: 'feature.audit.text' },
  { icon: CloudUpload, title: 'feature.uploads.title', text: 'feature.uploads.text' },
  { icon: CreditCard, title: 'feature.billing.title', text: 'feature.billing.text' },
  { icon: Webhook, title: 'feature.webhooks.title', text: 'feature.webhooks.text' },
  { icon: Container, title: 'feature.deploy.title', text: 'feature.deploy.text' },
];

const STACK = ['NestJS', 'Next.js', 'PostgreSQL', 'Prisma', 'Redis', 'BullMQ', 'Stripe', 'Docker', 'Turborepo', 'Tailwind CSS', 'shadcn/ui'];

const glass = 'border border-white/70 bg-card/60 shadow-xl shadow-primary/5 backdrop-blur-xl dark:border-white/10 dark:bg-card/50';

export default async function LandingPage() {
  const t = await getT();
  return (
    <div className="relative isolate overflow-hidden">
      <Backdrop />
      <a
        href="#main"
        className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-[3px] focus:ring-ring"
      >
        {t('common.skipToContent')}
      </a>
      <header className={cn('sticky top-0 z-20 border-x-0 border-t-0 shadow-none', glass)}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Brand />
          <nav aria-label={t('nav.main')} className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <a href="#features">{t('welcome.featuresLink')}</a>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <a href={REPO_URL}>GitHub</a>
            </Button>
            <LanguageSwitcher />
            <ThemeToggle />
            <Button asChild>
              <Link href="/login">{t('common.signIn')}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section className="mx-auto grid max-w-6xl justify-items-center gap-8 px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
          <p className={cn('rounded-full px-4 py-1.5 text-sm font-medium motion-safe:animate-rise', glass)}>{t('welcome.badge')}</p>
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-balance motion-safe:animate-rise motion-safe:[animation-delay:100ms] sm:text-6xl">
            {t('welcome.title')}{' '}
            <span className="bg-linear-to-r from-primary to-violet-600 bg-clip-text text-transparent dark:to-violet-400">{t('welcome.highlight')}</span>
          </h1>
          <p className="max-w-2xl text-lg text-pretty text-muted-foreground motion-safe:animate-rise motion-safe:[animation-delay:200ms]">{t('welcome.text')}</p>
          <div className="flex flex-wrap justify-center gap-3 motion-safe:animate-rise motion-safe:[animation-delay:300ms]">
            <Button asChild size="lg">
              <Link href="/login">
                {t('welcome.openDashboard')} <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className={glass}>
              <a href={REPO_URL}>
                {t('welcome.viewGithub')} <ArrowUpRight aria-hidden />
              </a>
            </Button>
          </div>
          <ApiWindow className="mt-8 motion-safe:animate-rise motion-safe:[animation-delay:450ms]" />
        </section>

        <section id="features" aria-labelledby="features-title" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 py-20 sm:px-6">
          <div className="reveal grid justify-items-center gap-3 text-center">
            <h2 id="features-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t('welcome.featuresTitle')}
            </h2>
            <p className="max-w-2xl text-muted-foreground">{t('welcome.featuresText')}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text, wide }) => (
              <li
                key={title}
                className={cn(
                  'reveal grid content-start gap-3 rounded-2xl p-6 transition-transform duration-300 motion-safe:hover:-translate-y-1',
                  glass,
                  wide && 'lg:col-span-2',
                )}
              >
                <span
                  aria-hidden
                  className="grid size-11 place-items-center rounded-xl bg-linear-to-br from-primary to-violet-600 text-primary-foreground shadow-lg shadow-primary/25 dark:to-violet-400"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="text-lg font-semibold">{t(title)}</h3>
                <p className="text-muted-foreground">{t(text)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="stack-title" className="reveal mx-auto grid max-w-6xl justify-items-center gap-6 px-4 py-12 text-center sm:px-6">
          <h2 id="stack-title" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
            {t('welcome.stackTitle')}
          </h2>
          <ul className="flex flex-wrap justify-center gap-3">
            {STACK.map((name) => (
              <li key={name} className={cn('rounded-full px-4 py-2 text-sm font-medium', glass)}>
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className={cn('reveal relative grid justify-items-center gap-6 overflow-hidden rounded-3xl px-6 py-16 text-center', glass)}>
            <div aria-hidden className="absolute -top-24 left-1/2 -z-10 size-72 -translate-x-1/2 rounded-full bg-primary/25 blur-3xl" />
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{t('welcome.ctaTitle')}</h2>
            <p className="max-w-xl text-muted-foreground">{t('welcome.ctaText')}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <a href={REPO_URL}>
                  {t('welcome.getCode')} <ArrowUpRight aria-hidden />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">{t('common.signIn')}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <Brand className="text-foreground" />
        <p>{t('welcome.footer')}</p>
      </footer>
    </div>
  );
}

// Slow-drifting colour behind the glass; still for people who ask for reduced motion.
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[64rem] overflow-hidden">
      <div className="absolute -top-40 -left-32 size-[36rem] rounded-full bg-primary/25 blur-3xl motion-safe:animate-drift" />
      <div className="absolute top-20 -right-40 size-[32rem] rounded-full bg-violet-500/20 blur-3xl motion-safe:animate-drift motion-safe:[animation-delay:-7s]" />
      <div className="absolute top-[30rem] left-1/3 size-[28rem] rounded-full bg-sky-400/20 blur-3xl motion-safe:animate-drift motion-safe:[animation-delay:-14s]" />
    </div>
  );
}

// A real call to this API: which optional modules are installed and switched on for the caller's tenant.
function ApiWindow({ className }: { className?: string }) {
  return (
    <figure className={cn('w-full max-w-3xl overflow-hidden rounded-2xl text-left', glass, className)}>
      <div className="flex items-center gap-2 border-b border-white/40 px-4 py-3 dark:border-white/10">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-400" />
          <span className="size-3 rounded-full bg-amber-400" />
          <span className="size-3 rounded-full bg-emerald-400" />
        </span>
        <figcaption className="ml-2 font-mono text-sm text-muted-foreground">GET /v1/system/capabilities</figcaption>
      </div>
      {/* Focusable: on narrow screens it scrolls sideways, and keyboard users must be able to scroll it too. */}
      <pre tabIndex={0} className="overflow-x-auto p-6 font-mono text-sm leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        <code>
          <span className="text-muted-foreground">{'{\n  '}</span>
          <Key>capabilities</Key>
          <span className="text-muted-foreground">{': [\n    '}</span>
          <Entry k="billing" provider={null} enabled />
          <span className="text-muted-foreground">{',\n    '}</span>
          <Entry k="email" provider="resend" enabled />
          <span className="text-muted-foreground">{',\n    '}</span>
          <Entry k="push" provider="fcm" enabled={false} />
          <span className="text-muted-foreground">{',\n    '}</span>
          <Entry k="storage" provider="r2" enabled />
          <span className="text-muted-foreground">{',\n    '}</span>
          <Entry k="webhooks" provider={null} enabled />
          <span className="text-muted-foreground">{'\n  ]\n}'}</span>
        </code>
      </pre>
    </figure>
  );
}

function Key({ children }: { children: string }) {
  return <span className="text-primary">&quot;{children}&quot;</span>;
}

// `provider` null: a module that needs no tenant configuration (billing uses the platform's Stripe account).
function Entry({ k, provider, enabled }: { k: string; provider: string | null; enabled: boolean }) {
  return (
    <>
      <span className="text-muted-foreground">{'{ '}</span>
      <Key>key</Key>: <span className="text-violet-700 dark:text-violet-300">&quot;{k}&quot;</span>, <Key>integration</Key>:{' '}
      {provider === null ? <span className="text-muted-foreground">null</span> : <span className="text-violet-700 dark:text-violet-300">&quot;{provider}&quot;</span>},{' '}
      <Key>enabled</Key>:{' '}
      <span className={enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{String(enabled)}</span>
      <span className="text-muted-foreground">{' }'}</span>
    </>
  );
}
