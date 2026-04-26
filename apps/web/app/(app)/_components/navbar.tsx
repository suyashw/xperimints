'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Pacifico } from 'next/font/google';
import { LayoutDashboard, FlaskConical, Plug, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { logoutAction } from '@/app/actions/auth';

const logoFont = Pacifico({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/experiments', label: 'Experiments', icon: FlaskConical },
  { href: '/integrations', label: 'Integrations', icon: Plug },
];

interface NavbarUser {
  email: string;
  name: string | null;
}

export function Navbar({ user }: { user?: NavbarUser }) {
  const pathname = usePathname() ?? '';
  const display = user?.name?.trim().length ? user.name : user?.email;

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 backdrop-blur-xl supports-[backdrop-filter]:bg-[color:var(--color-bg)]/60">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
        <Link
          href="/dashboard"
          className="group flex items-center gap-2.5 tracking-tight transition-opacity hover:opacity-90 hover:no-underline"
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

        <nav className="flex items-center gap-1 text-sm">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors hover:no-underline',
                  active
                    ? 'bg-[color:var(--color-fg)]/[0.06] text-[color:var(--color-fg)] font-medium'
                    : 'text-[color:var(--color-muted)] hover:bg-[color:var(--color-fg)]/[0.04] hover:text-[color:var(--color-fg)]',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="ml-auto flex items-center gap-2">
            <span
              className="hidden max-w-[180px] truncate text-xs text-[color:var(--color-muted)] sm:inline"
              title={user.email}
            >
              {display}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-muted)] hover:bg-[color:var(--color-fg)]/[0.04] hover:text-[color:var(--color-fg)]"
                aria-label="Log out"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
                <span>Log out</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
