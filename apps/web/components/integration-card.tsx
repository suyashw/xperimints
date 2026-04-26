'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  type IntegrationCardView,
  type IntegrationType,
  connectIntegrationAction,
  disconnectIntegrationAction,
  listIntegrationsAction,
  testIntegrationAction,
} from '@/app/actions/integrations';

interface IntegrationMeta {
  label: string;
  description: string;
  /** Per-field configuration. The first field with key `token` is the secret. */
  fields: Array<{
    key: string;
    label: string;
    placeholder: string;
    helper?: string;
    secret?: boolean;
    optional?: boolean;
  }>;
  docsUrl: string;
  /** When true, "Add connection" launches an OAuth popup instead of a form. */
  oauth?: boolean;
}

const META: Record<IntegrationType, IntegrationMeta> = {
  PEEC: {
    label: 'Peec MCP',
    description:
      'Brand visibility data, prompt + brand catalogs, and recommendations. Powers every experiment.',
    docsUrl: 'https://docs.peec.ai/mcp',
    oauth: true,
    fields: [],
  },
  GITHUB: {
    label: 'GitHub',
    description:
      'Read experiment.yaml from PRs, comment power-analysis verdicts, and stamp launch commits.',
    docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    fields: [
      {
        key: 'token',
        label: 'Personal access token',
        placeholder: 'ghp_…',
        helper: 'Needs repo + read:user scopes.',
        secret: true,
      },
    ],
  },
  VERCEL: {
    label: 'Vercel',
    description:
      'Stamp `launchAt` from production deploys and snapshot the live treatment URL on success.',
    docsUrl: 'https://vercel.com/docs/rest-api#authentication',
    fields: [
      {
        key: 'token',
        label: 'Access token',
        placeholder: 'vercel_xxx…',
        helper: 'Create one at vercel.com/account/tokens.',
        secret: true,
      },
    ],
  },
  LINEAR: {
    label: 'Linear',
    description:
      'Open Win / Loss / Inconclusive tickets when an experiment finalizes.',
    docsUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api#personal-api-keys',
    fields: [
      {
        key: 'token',
        label: 'API key',
        placeholder: 'lin_api_…',
        helper: 'Linear → Settings → API → Personal API keys.',
        secret: true,
      },
    ],
  },
};

export function IntegrationCard({ initial }: { initial: IntegrationCardView }) {
  const [card, setCard] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const [oauthPending, setOauthPending] = useState(false);

  const meta = META[card.type];
  const isConnected = card.status === 'ACTIVE';

  // OAuth popup → postMessage handler. Lives at the card level so closing the
  // popup also re-enables the button when the user bails.
  useEffect(() => {
    if (!meta.oauth) return undefined;

    function refreshFromServer() {
      startTransition(async () => {
        const result = await listIntegrationsAction();
        if (result.ok) {
          const next = result.data.find((c) => c.type === card.type);
          if (next) setCard(next);
        }
        router.refresh();
      });
    }

    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; error?: string } | null;
      if (!data) return;
      if (data.type !== 'peec_auth_success' && data.type !== 'peec_auth_error') return;
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      try {
        popupRef.current?.close();
      } catch {
        // popup may have self-closed
      }
      setOauthPending(false);
      if (data.type === 'peec_auth_success') {
        setError(null);
        refreshFromServer();
      } else {
        setError(data.error ?? 'Auth failed');
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, [meta.oauth, card.type, router]);

  const onOAuthConnect = () => {
    setError(null);
    setOauthPending(true);
    const w = 520;
    const h = 720;
    const y = window.top ? window.top.outerHeight / 2 + window.top.screenY - h / 2 : 100;
    const x = window.top ? window.top.outerWidth / 2 + window.top.screenX - w / 2 : 100;
    const popup = window.open(
      '/api/peec/oauth/start',
      'peec-oauth',
      `popup=yes,width=${w},height=${h},left=${x},top=${y}`,
    );
    if (!popup) {
      window.location.href = '/api/peec/oauth/start';
      return;
    }
    popupRef.current = popup;
    pollRef.current = window.setInterval(() => {
      if (popup.closed) {
        if (pollRef.current != null) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // Give the postMessage a beat to land before assuming the user bailed.
        window.setTimeout(() => setOauthPending((p) => (p ? false : p)), 400);
      }
    }, 500);
  };

  const onSubmit = (formData: FormData) => {
    setError(null);
    const credentials: Record<string, string> = {};
    for (const f of meta.fields) {
      const v = formData.get(f.key);
      if (typeof v === 'string' && v.trim().length > 0) {
        credentials[f.key] = v.trim();
      }
    }
    startTransition(async () => {
      const result = await connectIntegrationAction(card.type, credentials);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCard(result.data);
      setOpen(false);
      router.refresh();
    });
  };

  const onTest = () => {
    setError(null);
    startTransition(async () => {
      const result = await testIntegrationAction(card.type);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCard(result.data);
      router.refresh();
    });
  };

  const onDisconnect = () => {
    if (!confirm(`Disconnect ${meta.label}?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await disconnectIntegrationAction(card.type);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCard({
        ...card,
        status: 'NOT_CONNECTED',
        connectedAt: null,
        updatedAt: null,
        account: null,
        config: {},
      });
      router.refresh();
    });
  };

  return (
    <article className="flex flex-col rounded-lg border border-[color:var(--color-border)] bg-white p-5 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">{meta.label}</h3>
            <StatusBadge status={card.status} />
          </div>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">{meta.description}</p>
        </div>
      </header>

      <dl className="mt-4 space-y-1.5 text-xs">
        <Row label="Account" value={card.account ?? '—'} />
        <Row
          label="Connected"
          value={card.connectedAt ? formatDateTime(card.connectedAt) : '—'}
        />
        <Row
          label="Last verified"
          value={readLastVerified(card.config)}
        />
      </dl>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[color:var(--color-muted)] underline"
        >
          Where do I get this?
        </a>
        <div className="flex items-center gap-2">
          {isConnected && (
            <>
              <button
                type="button"
                onClick={onTest}
                disabled={isPending}
                className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--color-border)]/30 disabled:opacity-50"
              >
                {isPending ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                disabled={isPending}
                className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => (meta.oauth ? onOAuthConnect() : setOpen(true))}
            disabled={isPending || oauthPending}
            className="rounded-md bg-[color:var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
          >
            {meta.oauth
              ? oauthPending
                ? 'Authenticating…'
                : isConnected
                  ? 'Reconnect'
                  : 'Connect with OAuth'
              : isConnected
                ? 'Update credentials'
                : 'Add connection'}
          </button>
        </div>
      </div>

      {open && !meta.oauth && (
        <CredentialsModal
          meta={meta}
          isPending={isPending}
          onClose={() => {
            if (!isPending) setOpen(false);
          }}
          onSubmit={onSubmit}
        />
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: IntegrationCardView['status'] }) {
  const styles: Record<IntegrationCardView['status'], string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-900',
    NEEDS_REAUTH: 'bg-amber-100 text-amber-900',
    DISABLED: 'bg-zinc-100 text-zinc-700',
    NOT_CONNECTED: 'bg-zinc-100 text-zinc-600',
  };
  const labels: Record<IntegrationCardView['status'], string> = {
    ACTIVE: 'Connected',
    NEEDS_REAUTH: 'Needs re-auth',
    DISABLED: 'Disabled',
    NOT_CONNECTED: 'Not connected',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </dt>
      <dd className="truncate text-right text-xs font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function readLastVerified(config: Record<string, unknown>): string {
  const v = config.lastVerifiedAt;
  if (typeof v !== 'string') return '—';
  return formatDateTime(v);
}

/**
 * Deterministic date-time formatter pinned to `en-GB` so SSR and CSR
 * produce identical strings. The default `toLocaleString()` reads the
 * runtime's locale — Node falls back to the OS locale on the server,
 * the browser uses the user's locale on the client — which causes
 * hydration mismatches when the two locales differ (e.g. server outputs
 * "23/04/2026, 16:10:04" while the user's browser outputs
 * "4/23/2026, 4:10:04 PM"). Pinning the locale + options eliminates the
 * mismatch without losing readability.
 *
 * Returns `'—'` for unparseable input (mirrors the previous fallback in
 * `readLastVerified`) so call sites don't need to wrap this in
 * try/catch.
 */
function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function CredentialsModal({
  meta,
  isPending,
  onClose,
  onSubmit,
}: {
  meta: IntegrationMeta;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[color:var(--color-border)] bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-tight">
          Connect {meta.label}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          We&apos;ll verify the credentials by calling {meta.label}&apos;s API
          right away. If it succeeds, the secret is encrypted with AES-256-GCM
          before being stored.
        </p>
        <form
          action={onSubmit}
          className="mt-4 space-y-3"
        >
          {meta.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium text-[color:var(--color-fg)]">
                {f.label}
                {f.optional && (
                  <span className="ml-1 text-[10px] text-[color:var(--color-muted)]">
                    (optional)
                  </span>
                )}
              </span>
              <input
                name={f.key}
                type={f.secret ? 'password' : 'text'}
                placeholder={f.placeholder}
                required={!f.optional}
                autoComplete="off"
                className="mt-1 block w-full rounded-md border border-[color:var(--color-border)] bg-white px-3 py-2 text-sm font-mono outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
              />
              {f.helper && (
                <span className="mt-1 block text-[11px] text-[color:var(--color-muted)]">
                  {f.helper}
                </span>
              )}
            </label>
          ))}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--color-border)]/30 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-[color:var(--color-accent)] px-4 py-1.5 text-sm font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Verifying…' : 'Verify & save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
