/**
 * ExperimentTimeline — vertical timeline of ExperimentEvents.
 * Renders cleanly even with 30+ events (which is roughly a 14-day RUNNING
 * experiment with daily snapshots + a verdict computation).
 */

import type { EventType } from '@peec-lab/database';

interface TimelineEvent {
  id: string;
  type: EventType;
  createdAt: Date;
  payload?: unknown;
}

const STYLE: Partial<Record<EventType, { label: string; dot: string; tint: string }>> = {
  CREATED: { label: 'Created', dot: 'bg-zinc-400', tint: 'text-zinc-700' },
  POWER_ANALYZED: { label: 'Power analysed', dot: 'bg-blue-400', tint: 'text-blue-700' },
  BASELINE_CAPTURED: {
    label: 'Baseline captured',
    dot: 'bg-blue-400',
    tint: 'text-blue-700',
  },
  LAUNCHED: { label: 'Launched', dot: 'bg-violet-500', tint: 'text-violet-700' },
  SNAPSHOTTED: { label: 'Snapshot', dot: 'bg-amber-400', tint: 'text-amber-700' },
  RESULT_COMPUTED: { label: 'Verdict', dot: 'bg-emerald-500', tint: 'text-emerald-700' },
  LINEAR_TICKET_CREATED: {
    label: 'Linear ticket opened',
    dot: 'bg-indigo-500',
    tint: 'text-indigo-700',
  },
  PR_COMMENTED: { label: 'PR comment posted', dot: 'bg-sky-500', tint: 'text-sky-700' },
  PEEC_TOPIC_CREATED: {
    label: 'Peec topic created',
    dot: 'bg-fuchsia-500',
    tint: 'text-fuchsia-700',
  },
  PEEC_TAG_CREATED: { label: 'Peec tag created', dot: 'bg-fuchsia-500', tint: 'text-fuchsia-700' },
  ERROR: { label: 'Error', dot: 'bg-red-500', tint: 'text-red-700' },
};

function fmtDate(d: Date): string {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ExperimentTimeline({ events }: { events: ReadonlyArray<TimelineEvent> }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-[color:var(--color-muted)] italic">No events yet.</p>
    );
  }
  return (
    <ol className="relative ml-2 border-l border-[color:var(--color-border)]">
      {events.map((ev) => {
        const s = STYLE[ev.type] ?? {
          label: ev.type,
          dot: 'bg-zinc-300',
          tint: 'text-zinc-600',
        };
        const subtitle = renderPayloadHint(ev.type, ev.payload);
        return (
          <li key={ev.id} className="ml-4 mb-3 relative">
            <span
              className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-[color:var(--color-bg)] ${s.dot}`}
              aria-hidden
            />
            <div className="flex items-baseline gap-3">
              <span className={`text-xs font-medium ${s.tint}`}>{s.label}</span>
              <span className="text-[10px] tabular-nums text-[color:var(--color-muted)]">
                {fmtDate(ev.createdAt)}
              </span>
            </div>
            {subtitle && (
              <p className="text-xs text-[color:var(--color-muted)] mt-0.5">{subtitle}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function renderPayloadHint(type: EventType, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'POWER_ANALYZED':
      if (typeof p.power === 'number') {
        const days = typeof p.recommendedDays === 'number' ? `${p.recommendedDays}d` : '—';
        return `${(p.power * 100).toFixed(0)}% power · ${days}`;
      }
      return null;
    case 'PR_COMMENTED':
      return typeof p.url === 'string' ? p.url : null;
    case 'LINEAR_TICKET_CREATED':
      return typeof p.identifier === 'string' ? `Linear ${p.identifier}` : null;
    case 'PEEC_TOPIC_CREATED':
    case 'PEEC_TAG_CREATED':
      return typeof p.name === 'string' ? `name: ${p.name}` : null;
    case 'RESULT_COMPUTED':
      if (typeof p.overallPValue === 'number') {
        return `corrected p = ${p.overallPValue.toFixed(4)}`;
      }
      return null;
    case 'LAUNCHED':
      return typeof p.deploymentId === 'string' ? `deploy ${p.deploymentId}` : null;
    default:
      return null;
  }
}
