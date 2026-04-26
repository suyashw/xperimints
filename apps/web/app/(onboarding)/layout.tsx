import Link from 'next/link';
import { Pacifico } from 'next/font/google';
import { logoutAction } from '@/app/actions/auth';
import { requireUserAllowingOnboarding } from '@/lib/auth';

const logoFont = Pacifico({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

export const dynamic = 'force-dynamic';

/**
 * Wraps the post-signup onboarding flow. Redirects unauthenticated
 * users to /login and already-onboarded users to /dashboard so the
 * page is only ever served to brand-new accounts.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUserAllowingOnboarding();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--color-border)]/70 px-6 py-3">
        <Link
          href="/onboarding"
          className="group inline-flex items-center gap-2.5 tracking-tight transition-opacity hover:opacity-90 hover:no-underline"
        >
          <span
            aria-hidden
            className={`${logoFont.className} relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[color:var(--color-accent)] to-[oklch(48%_0.22_280)] text-[color:var(--color-accent-fg)] text-base leading-none shadow-sm ring-1 ring-inset ring-white/15 shadow-[oklch(58%_0.18_250)]/30`}
          >
            x
          </span>
          <span
            className={`${logoFont.className} bg-gradient-to-br from-[color:var(--color-fg)] to-[color:var(--color-fg)]/70 bg-clip-text text-xl leading-none text-transparent lowercase`}
          >
            xperimints
          </span>
        </Link>
        <form action={logoutAction}>
          <span className="mr-3 text-xs text-[color:var(--color-muted)]">
            {user.email}
          </span>
          <button
            type="submit"
            className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--color-border)]/30"
          >
            Log out
          </button>
        </form>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}
