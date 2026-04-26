'use client';

import { useActionState } from 'react';
import { loginAction, type AuthFormState } from '@/app/actions/auth';

const initialState: AuthFormState | undefined = undefined;

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        defaultValue={state?.email ?? ''}
        placeholder="you@company.com"
        required
      />
      <Field
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
      />

      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  type,
  placeholder,
  autoComplete,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[color:var(--color-fg)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
      />
    </label>
  );
}
