import type { ExperimentStatus } from '@peec-lab/database';
import { cn } from '@/lib/utils';

const STYLE: Record<ExperimentStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-zinc-200/60 text-zinc-800' },
  SCHEDULED: { label: 'Scheduled', className: 'bg-blue-100 text-blue-900' },
  RUNNING: { label: 'Running', className: 'bg-amber-100 text-amber-900' },
  ANALYZING: { label: 'Analyzing', className: 'bg-purple-100 text-purple-900' },
  WIN: { label: 'Win', className: 'bg-emerald-100 text-emerald-900' },
  LOSS: { label: 'Loss', className: 'bg-red-100 text-red-900' },
  INCONCLUSIVE: {
    label: 'Inconclusive',
    className: 'bg-zinc-200 text-zinc-700',
  },
  CANCELLED: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-500' },
  ERRORED: { label: 'Errored', className: 'bg-red-100 text-red-900' },
};

export function ExperimentStatusPill({ status }: { status: ExperimentStatus }) {
  const s = STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}
