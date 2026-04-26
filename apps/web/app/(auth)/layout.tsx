import Link from 'next/link';
import { Pacifico } from 'next/font/google';
import { redirectIfAuthenticated } from '@/lib/auth';

const logoFont = Pacifico({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

export const dynamic = 'force-dynamic';

/**
 * Layout for `/login` and `/signup`. Redirects already-authenticated
 * users away (to dashboard or onboarding, depending on their state) so
 * they don't see a stale auth form after refreshing the URL.
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await redirectIfAuthenticated();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5">
        <Link
          href="/login"
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
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
