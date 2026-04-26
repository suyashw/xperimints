import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Log in · Xperimints',
};

export default function LoginPage() {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-white p-8 shadow-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Log in to keep running experiments.
        </p>
      </header>

      <LoginForm />

      <p className="mt-6 text-center text-xs text-[color:var(--color-muted)]">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="font-medium text-[color:var(--color-accent)] underline-offset-2 hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
