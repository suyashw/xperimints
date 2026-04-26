'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ExperimentStatus } from '@peec-lab/database';
import { formatPpDelta } from '@peec-lab/ui';
import { ExperimentStatusPill } from './experiment-status-pill';
import { EmptyState } from './empty-state';
import { ExperimentActionPlanModal } from './experiment-action-plan-modal';

export interface ExperimentTableRow {
  id: string;
  name: string;
  status: ExperimentStatus;
  treatmentUrl: string;
  treatmentPromptIds: string[];
  hypothesis: string;
  minLiftPp: number;
  isPublic: boolean;
  shareSlug: string;
  liftByEngine: Record<
    string,
    { lift_pp: number; p_value_corrected?: number }
  > | null;
}

/**
 * Client-side wrapper around the experiments table. Owns the
 * "row → modal" interaction so the parent page can stay a server
 * component and stream the experiment list directly from Prisma.
 *
 * Clicking a row opens `ExperimentActionPlanModal` with the
 * experiment's treatment prompt — the modal renders the same
 * Recommended Actions section that lives on /experiments/new, so the
 * user can review (and re-generate) AI content suggestions for any
 * existing experiment without leaving the list.
 */
export function ExperimentsTable({
  experiments,
}: {
  experiments: ExperimentTableRow[];
}) {
  const [active, setActive] = useState<ExperimentTableRow | null>(null);

  return (
    <>
      <div className="rounded-lg border border-[color:var(--color-border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--color-border)]/30 text-xs uppercase text-[color:var(--color-muted)]">
            <tr>
              <th className="text-left p-3 font-medium">Experiment</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-right p-3 font-medium">Min lift</th>
              <th className="text-right p-3 font-medium">Best lift</th>
              <th className="text-right p-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {experiments.map((exp) => {
              const lifts = exp.liftByEngine ?? {};
              const best = Object.values(lifts)
                .filter((l) => (l.p_value_corrected ?? 1) < 0.05)
                .sort((a, b) => b.lift_pp - a.lift_pp)[0];
              const open = () => setActive(exp);
              const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open();
                }
              };
              return (
                <tr
                  key={exp.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open recommended actions for ${exp.name}`}
                  onClick={open}
                  onKeyDown={onKey}
                  className="border-t border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/20 cursor-pointer focus:outline-none focus:bg-[color:var(--color-border)]/30 focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
                >
                  <td className="p-3">
                    <div className="font-medium">{exp.name}</div>
                    <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                      {exp.treatmentUrl}
                    </div>
                  </td>
                  <td className="p-3">
                    <ExperimentStatusPill status={exp.status} />
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {exp.minLiftPp}pp
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {best ? formatPpDelta(best.lift_pp / 100) : '—'}
                  </td>
                  <td className="p-3 text-right">
                    {exp.isPublic && (
                      <Link
                        href={`/r/${exp.shareSlug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs underline text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
                      >
                        /r/{exp.shareSlug}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {experiments.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6">
                  <EmptyState
                    title="No experiments yet"
                    description="Open the dashboard, click an under-performing prompt, and hit Implement experiment to record your first draft here."
                    action={
                      <Link
                        href="/dashboard#prompt-visibility"
                        className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-accent)] px-3 py-1.5 text-sm text-[color:var(--color-accent-fg)]"
                      >
                        Pick a prompt to implement
                      </Link>
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active && (
        <ExperimentActionPlanModal
          experiment={active}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
