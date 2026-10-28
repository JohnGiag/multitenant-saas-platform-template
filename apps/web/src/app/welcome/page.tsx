import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CloudUpload,
  Fingerprint,
  Gauge,
  LockKeyhole,
  Puzzle,
  ScrollText,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';

// The landing page signed-out visitors get at / (proxy.ts). Its copy describes this template: a project built on it
// replaces the constants below with its own product's and keeps the layout.

export const metadata: Metadata = { title: { absolute: 'Enterprise API Starter' } };

const REPO_URL = 'https://github.com/JohnGiag/multitenant-api-template';

const HERO = {
  badge: 'Open source · MIT licensed',
  title: 'The multi-tenant SaaS core',
  highlight: 'you would build anyway.',
  text: 'Tenancy, auth, roles, API keys, encrypted tenant secrets, rate limiting, jobs and notifications — already built, tested and documented. Start on your product on day one.',
};

// `wide` cards span two columns of the grid on large screens.
const FEATURES = [
  {
    icon: Building2,
    title: 'Multi-tenant by default',
    text: 'Every table carries a tenant ID, every query filters by it, and a test proves tenant A never reads tenant B.',
    wide: true,
  },
  { icon: Fingerprint, title: 'Pluggable auth', text: 'Built-in JWT with Argon2id, or Clerk. One setting switches them.' },
  { icon: ShieldCheck, title: 'Role-based access', text: 'Four roles, guards on every route, denied by default.' },
  { icon: LockKeyhole, title: 'Bring your own keys', text: 'Tenant secrets sealed with AES-256-GCM, never returned by the API.' },
  { icon: Gauge, title: 'Rate limiting', text: 'Redis sliding windows per tenant, user and tier, with Retry-After.' },
  { icon: Workflow, title: 'Background jobs', text: 'BullMQ workers with retries, backoff and dead-letter queues.' },
  {
    icon: Puzzle,
    title: 'Plug-and-play modules',
    text: 'Email, push and file storage are folders. Delete one and the app still compiles; the dashboard hides its settings.',
    wide: true,
  },
  { icon: Bell, title: 'Notifications', text: 'Real-time SSE, push through FCM and email through Resend.' },
  { icon: ScrollText, title: 'Audit trail', text: 'Every write logged, with ISO 27001, 27701 and 42001 in mind.' },
  { icon: CloudUpload, title: 'Direct uploads', text: 'Presigned URLs to R2 or S3: file bytes never touch the API.' },
];

const STACK = ['NestJS', 'Next.js', 'PostgreSQL', 'Prisma', 'Redis', 'BullMQ', 'Turborepo', 'Tailwind CSS', 'shadcn/ui'];

const glass = 'border border-white/70 bg-card/60 shadow-xl shadow-primary/5 backdrop-blur-xl dark:border-white/10 dark:bg-card/50';

export default function LandingPage() {
  return (
    <div className="relative isolate overflow-hidden">
      <Backdrop />
      <a
        href="#main"
        className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-[3px] focus:ring-ring"
      >
        Skip to content
      </a>
      <header className={cn('sticky top-0 z-20 border-x-0 border-t-0 shadow-none', glass)}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Brand />
          <nav aria-label="Main" className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <a href="#features">Features</a>
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <a href={REPO_URL}>GitHub</a>
            </Button>
            <ThemeToggle />
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section className="mx-auto grid max-w-6xl justify-items-center gap-8 px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
          <p className={cn('rounded-full px-4 py-1.5 text-sm font-medium motion-safe:animate-rise', glass)}>{HERO.badge}</p>
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-balance motion-safe:animate-rise motion-safe:[animation-delay:100ms] sm:text-6xl">
            {HERO.title}{' '}
            <span className="bg-linear-to-r from-primary to-violet-600 bg-clip-text text-transparent dark:to-violet-400">{HERO.highlight}</span>
          </h1>
          <p className="max-w-2xl text-lg text-pretty text-muted-foreground motion-safe:animate-rise motion-safe:[animation-delay:200ms]">{HERO.text}</p>
          <div className="flex flex-wrap justify-center gap-3 motion-safe:animate-rise motion-safe:[animation-delay:300ms]">
            <Button asChild size="lg">
              <Link href="/login">
                Open the dashboard <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className={glass}>
              <a href={REPO_URL}>
                View on GitHub <ArrowUpRight aria-hidden />
              </a>
            </Button>
          </div>
          <ApiWindow className="mt-8 motion-safe:animate-rise motion-safe:[animation-delay:450ms]" />
        </section>

        <section id="features" aria-labelledby="features-title" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 py-20 sm:px-6">
          <div className="reveal grid justify-items-center gap-3 text-center">
            <h2 id="features-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything a SaaS needs before its first feature
            </h2>
            <p className="max-w-2xl text-muted-foreground">Each piece follows one rule set, written down in CLAUDE.md and enforced by tests.</p>
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
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="stack-title" className="reveal mx-auto grid max-w-6xl justify-items-center gap-6 px-4 py-12 text-center sm:px-6">
          <h2 id="stack-title" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
            Built on tools you already know
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
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Start on your product, not on plumbing.</h2>
            <p className="max-w-xl text-muted-foreground">Clone the repository, run one command, and sign in to a working dashboard.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <a href={REPO_URL}>
                  Get the code <ArrowUpRight aria-hidden />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <Brand className="text-foreground" />
        <p>MIT licensed. Built with NestJS and Next.js.</p>
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
          <Entry k="email" provider="resend" enabled />
          <span className="text-muted-foreground">{',\n    '}</span>
          <Entry k="push" provider="fcm" enabled={false} />
          <span className="text-muted-foreground">{',\n    '}</span>
          <Entry k="storage" provider="r2" enabled />
          <span className="text-muted-foreground">{'\n  ]\n}'}</span>
        </code>
      </pre>
    </figure>
  );
}

function Key({ children }: { children: string }) {
  return <span className="text-primary">&quot;{children}&quot;</span>;
}

function Entry({ k, provider, enabled }: { k: string; provider: string; enabled: boolean }) {
  return (
    <>
      <span className="text-muted-foreground">{'{ '}</span>
      <Key>key</Key>: <span className="text-violet-700 dark:text-violet-300">&quot;{k}&quot;</span>, <Key>integration</Key>:{' '}
      <span className="text-violet-700 dark:text-violet-300">&quot;{provider}&quot;</span>, <Key>enabled</Key>:{' '}
      <span className={enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{String(enabled)}</span>
      <span className="text-muted-foreground">{' }'}</span>
    </>
  );
}
