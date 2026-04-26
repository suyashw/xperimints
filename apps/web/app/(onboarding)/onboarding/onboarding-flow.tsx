'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FolderKanban, Plug, Sparkles } from 'lucide-react';
import { completeOnboardingAction } from '@/app/actions/auth';
import {
  listPeecProjects,
  triggerPeecSync,
  type PeecProjectChoice,
} from '@/app/actions/peec-sync';

/**
 * Linear step machine for the onboarding screen:
 *
 *   connect   → user clicks "Connect Peec"; OAuth popup runs
 *   pick      → auth succeeded; we list Peec projects and ask which
 *               one this workspace should attach to
 *   syncing   → user picked a project; we run the foreground sync so
 *               the dashboard has data on first render
 *   done      → onboarding flag flipped, redirecting to /dashboard
 *
 * Errors are surfaced inline at every step but never block the user
 * from reaching the dashboard — they can always finish onboarding via
 * "Skip for now" and connect from /integrations later.
 */
type Step = 'connect' | 'pick' | 'syncing' | 'done';
type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'error';

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('connect');
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<PeecProjectChoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; error?: string } | null;
      if (!data) return;
      if (data.type !== 'peec_auth_success' && data.type !== 'peec_auth_error') {
        return;
      }
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      try {
        popupRef.current?.close();
      } catch {
        // popup may have self-closed
      }
      if (data.type === 'peec_auth_success') {
        setConnectStatus('connected');
        setError(null);
        // Brief moment of "Connected" before fetching the project list,
        // so the user gets visual confirmation that auth landed.
        window.setTimeout(() => loadProjectsAndAdvance(), 300);
      } else {
        setConnectStatus('error');
        setError(data.error ?? 'Peec auth failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
    // The handlers below are stable enough for this single-mount usage —
    // re-binding the listener mid-flow would lose the popup reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPeecPopup() {
    setError(null);
    setConnectStatus('connecting');
    const w = 520;
    const h = 720;
    const y = window.top
      ? window.top.outerHeight / 2 + window.top.screenY - h / 2
      : 100;
    const x = window.top
      ? window.top.outerWidth / 2 + window.top.screenX - w / 2
      : 100;
    const popup = window.open(
      '/api/peec/oauth/start',
      'peec-oauth',
      `popup=yes,width=${w},height=${h},left=${x},top=${y}`,
    );
    if (!popup) {
      // Popup blocked → full-page redirect into Peec OAuth. The callback
      // route lands on /dashboard, where our auth gate will bounce the
      // user back here (onboardedAt still null) so they can finish the
      // welcome step.
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
        window.setTimeout(() => {
          setConnectStatus((prev) => (prev === 'connecting' ? 'idle' : prev));
        }, 400);
      }
    }, 500);
  }

  /**
   * Called once Peec OAuth returns success. We fetch the user's Peec
   * project list so they can pick one before any local cache is
   * written. Single-project workspaces auto-advance into sync.
   *
   * Skipping is no longer offered — the dashboard is useless without
   * a connected project, so we keep the user here until they pick one
   * (or they create a project in Peec and click Retry).
   */
  function loadProjectsAndAdvance() {
    startTransition(async () => {
      setStep('pick');
      setError(null);
      const result = await listPeecProjects();
      if (!result.ok) {
        setError(`Connected, but couldn't list Peec projects: ${result.error}`);
        setProjects([]);
        return;
      }
      setProjects(result.projects);
      if (result.projects.length === 0) {
        // Nothing to pick. Tell the user, leave them on this step so
        // they can create a project in Peec and then click Retry.
        return;
      }
      // Auto-advance the no-choice case: one project → just sync it.
      if (result.projects.length === 1) {
        const only = result.projects[0]!;
        setSelectedId(only.id);
        await syncAndFinish(only.id);
        return;
      }
      // Pre-select the first row so the primary button has a target.
      setSelectedId(result.projects[0]!.id);
    });
  }

  /**
   * Pin the chosen Peec project locally (foreground sync), then flip
   * `onboardedAt` and route to the dashboard. Sync failures bounce
   * the user back to the picker with the error inline so they can
   * retry — they can't reach the dashboard without a successful sync.
   */
  function syncAndFinish(projectId: string) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        setStep('syncing');
        const result = await triggerPeecSync({ peecProjectId: projectId });
        if (!result.ok) {
          setError(`Couldn't pull project data: ${result.error}`);
          // Drop back to the picker so the user can choose a different
          // project or click "Use this project" again to retry.
          setStep('pick');
          resolve();
          return;
        }
        await completeOnboardingAction();
        setStep('done');
        router.push('/dashboard');
        resolve();
      });
    });
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]">
          <Sparkles className="h-6 w-6" strokeWidth={2} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          Welcome to Xperimints
        </h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          {step === 'pick' || step === 'syncing'
            ? 'One last thing — pick the Peec project this workspace should track.'
            : 'One quick step before your first experiment: connect Peec MCP so we can pull your prompts, brands, and visibility metrics.'}
        </p>
      </div>

      {(step === 'connect' || step === 'done') && (
        <ConnectCard
          status={connectStatus}
          error={error}
          isBusy={pending || connectStatus === 'connecting' || connectStatus === 'connected'}
          onConnect={openPeecPopup}
        />
      )}

      {(step === 'pick' || step === 'syncing') && (
        <ProjectPickerCard
          step={step}
          projects={projects}
          selectedId={selectedId}
          isBusy={pending}
          error={error}
          onSelect={setSelectedId}
          onConfirm={() => {
            if (selectedId) void syncAndFinish(selectedId);
          }}
          onRetry={loadProjectsAndAdvance}
        />
      )}

      <p className="text-center text-[11px] text-[color:var(--color-muted)]">
        You can change your selection or reconnect Peec later from the
        Integrations page.
      </p>
    </div>
  );
}

function ConnectCard({
  status,
  error,
  isBusy,
  onConnect,
}: {
  status: ConnectStatus;
  error: string | null;
  isBusy: boolean;
  onConnect: () => void;
}) {
  return (
    <article className="rounded-2xl border border-[color:var(--color-border)] bg-white p-6 shadow-sm">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-fg)]/[0.04] text-[color:var(--color-fg)]">
          <Plug className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold tracking-tight">
            Connect Peec MCP
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            We&apos;ll open a Peec OAuth window. After you approve, we&apos;ll
            ask you to pick which project this workspace should track.
          </p>
        </div>
        <ConnectStatusBadge status={status} />
      </header>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      <ul className="mt-4 space-y-1.5 text-xs text-[color:var(--color-muted)]">
        <Bullet>Reads your prompts, brands, models, and topics</Bullet>
        <Bullet>Tokens are encrypted at rest with AES-256-GCM</Bullet>
        <Bullet>Disconnect any time from the Integrations page</Bullet>
      </ul>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onConnect}
          disabled={isBusy}
          className="rounded-md bg-[color:var(--color-accent)] px-4 py-1.5 text-xs font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          {status === 'connecting' && 'Authenticating…'}
          {status === 'connected' && 'Connected'}
          {(status === 'idle' || status === 'error') && 'Connect Peec'}
        </button>
      </div>
    </article>
  );
}

function ProjectPickerCard({
  step,
  projects,
  selectedId,
  isBusy,
  error,
  onSelect,
  onConfirm,
  onRetry,
}: {
  step: 'pick' | 'syncing';
  projects: PeecProjectChoice[];
  selectedId: string | null;
  isBusy: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const isSyncing = step === 'syncing';
  // While `loadProjectsAndAdvance` is running, `isBusy` is true and the
  // list is still empty — that's the loading state. Once the action
  // resolves, `isBusy` flips false and we either have rows, an error,
  // or genuinely zero projects in the workspace.
  const isLoading = isBusy && step === 'pick' && projects.length === 0;
  const isEmpty =
    !isBusy && step === 'pick' && projects.length === 0 && !error;

  return (
    <article className="rounded-2xl border border-[color:var(--color-border)] bg-white p-6 shadow-sm">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-fg)]/[0.04] text-[color:var(--color-fg)]">
          <FolderKanban className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold tracking-tight">
            Pick a Peec project
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {isSyncing
              ? 'Pulling your prompts, brands, and analytics into Xperimints…'
              : 'Each Xperimints workspace tracks one Peec project at a time. You can change this later from Integrations.'}
          </p>
        </div>
        <PickerStatusBadge step={step} />
      </header>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      {isLoading && (
        <p className="mt-4 text-xs text-[color:var(--color-muted)]">
          Loading your Peec projects…
        </p>
      )}

      {isEmpty && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          We couldn&apos;t find any projects in your Peec workspace. Create
          one in Peec, then click <span className="font-semibold">Retry</span>{' '}
          to refresh the list.
        </div>
      )}

      {!isLoading && !isEmpty && projects.length > 0 && (
        <div className="mt-4 max-h-72 overflow-y-auto rounded-md border border-[color:var(--color-border)]">
          <ul role="radiogroup" aria-label="Peec project" className="divide-y divide-[color:var(--color-border)]">
            {projects.map((p) => {
              const checked = p.id === selectedId;
              return (
                <li key={p.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-[color:var(--color-fg)]/[0.03] ${checked ? 'bg-[color:var(--color-accent)]/[0.06]' : ''}`}
                  >
                    <input
                      type="radio"
                      name="peec-project"
                      value={p.id}
                      checked={checked}
                      onChange={() => onSelect(p.id)}
                      disabled={isBusy}
                      className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
                    />
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    {p.status && (
                      <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
                        {p.status}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {(isEmpty || error) && !isSyncing && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isBusy}
            className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--color-border)]/30 disabled:opacity-50"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={isBusy || !selectedId || projects.length === 0}
          className="rounded-md bg-[color:var(--color-accent)] px-4 py-1.5 text-xs font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          {isSyncing ? 'Syncing…' : 'Use this project'}
        </button>
      </div>
    </article>
  );
}

function ConnectStatusBadge({ status }: { status: ConnectStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === 'connecting') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
        Connecting…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-900">
        Failed
      </span>
    );
  }
  return null;
}

function PickerStatusBadge({ step }: { step: 'pick' | 'syncing' }) {
  if (step === 'syncing') {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-900">
        Syncing…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
      <CheckCircle2 className="h-3 w-3" /> Connected
    </span>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-accent)]"
        strokeWidth={2.25}
      />
      <span>{children}</span>
    </li>
  );
}
