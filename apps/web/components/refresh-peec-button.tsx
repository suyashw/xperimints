'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { triggerPeecSync, type PeecSyncResultSummary } from '@/app/actions/peec-sync';

/**
 * Manual "Refresh from Peec" button shown on the dashboard PeecProjectPanel
 * whenever the MCP is connected. Hits the API's POST /v1/peec/sync (which
 * always runs, bypassing the 5-min auto-throttle), then refreshes the route
 * so the cards re-render with the freshly persisted PeecProject row +
 * analytics caches.
 *
 * Status messages are shown inline below the button so the user gets
 * immediate feedback without a toast system.
 */
export function RefreshPeecButton({
  size = 'md',
  variant = 'solid',
}: {
  size?: 'sm' | 'md';
  variant?: 'solid' | 'outline';
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<PeecSyncResultSummary | null>(null);

  const onClick = () => {
    setStatus(null);
    startTransition(async () => {
      const result = await triggerPeecSync();
      setStatus(result);
      if (result.ok) router.refresh();
    });
  };

  const padding = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs';
  const palette =
    variant === 'outline'
      ? 'border border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/30'
      : 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] hover:opacity-90';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium disabled:opacity-50 ${padding} ${palette}`}
      >
        <RefreshIcon spinning={isPending} />
        {isPending ? 'Refreshing…' : 'Refresh from Peec'}
      </button>
      {status && <StatusLine status={status} />}
    </div>
  );
}

function StatusLine({ status }: { status: PeecSyncResultSummary }) {
  if (!status.ok) {
    return (
      <span className="text-[11px] text-red-700 max-w-xs text-right">
        {status.error ?? 'Sync failed'}
      </span>
    );
  }
  if (!status.projectName) {
    return (
      <span className="text-[11px] text-[color:var(--color-muted)]">
        Synced — no project found in Peec workspace.
      </span>
    );
  }
  const parts: string[] = [];
  if (typeof status.promptCount === 'number') parts.push(`${status.promptCount} prompts`);
  if (typeof status.brandCount === 'number') parts.push(`${status.brandCount} brands`);
  if (typeof status.modelCount === 'number') parts.push(`${status.modelCount} models`);
  if (typeof status.snapshotsCaptured === 'number' && status.snapshotsCaptured > 0) {
    parts.push(`${status.snapshotsCaptured} snapshot(s)`);
  }
  return (
    <span className="text-[11px] text-emerald-700 text-right">
      Synced {status.projectName}
      {parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
      {typeof status.durationMs === 'number' ? ` · ${status.durationMs}ms` : ''}
    </span>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}
