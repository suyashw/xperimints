'use client';

import { useState } from 'react';
import type { ProjectAnalytics } from '@/lib/data';

/**
 * EngineCoverageCard — visibility per tracked Peec model.
 *
 * Most projects track a long tail of engines but only a couple actually
 * surface the brand on a given window (e.g. only `chatgpt-scraper` was
 * non-zero on the demo project). Showing every zero row drowns the
 * actionable signal, so we collapse zero-coverage engines behind a
 * "Show N more" toggle. The "Show more" set is the action a user takes
 * when picking treatment engines for an experiment — engines with 0%
 * coverage are headroom candidates, but they shouldn't be the default
 * focal point.
 *
 * Client component because the toggle is purely UI state.
 */
export function EngineCoverageCard({
  engineVisibility,
  trackedModels,
}: {
  engineVisibility: ProjectAnalytics['engineVisibility'];
  trackedModels: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  const byModel = new Map<string, { visibility: number; share_of_voice?: number }>();
  for (const r of engineVisibility) {
    byModel.set(r.model_id, { visibility: r.visibility, share_of_voice: r.share_of_voice });
  }
  const all = trackedModels
    .map((m) => {
      const v = byModel.get(m);
      return {
        model_id: m,
        visibility: v?.visibility ?? 0,
        share_of_voice: v?.share_of_voice,
      };
    })
    .sort((a, b) => b.visibility - a.visibility);

  const covered = all.filter((r) => r.visibility > 0);
  const zero = all.filter((r) => r.visibility === 0);
  const visible = expanded ? all : covered;
  const max = Math.max(...all.map((r) => r.visibility), 0.0001);

  return (
    <section className="rounded-lg border border-[color:var(--color-border)] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
          Engine coverage
        </h2>
        <span className="text-[11px] text-[color:var(--color-muted)]">
          {covered.length}/{all.length} engines surfacing your brand
        </span>
      </div>

      {all.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">
          No engines tracked. Connect engines in Peec to see per-model lift.
        </p>
      ) : covered.length === 0 && !expanded ? (
        <div className="rounded-md border border-dashed border-[color:var(--color-border)] p-4 text-sm text-[color:var(--color-muted)]">
          No tracked engine surfaced your brand in the last 14 days. Every
          engine is a treatment candidate.
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-2 text-[color:var(--color-accent)] hover:underline"
          >
            Show all {all.length} →
          </button>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((r) => (
            <li key={r.model_id} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <code className="text-xs">{r.model_id}</code>
                <span
                  className={`tabular-nums text-xs ${
                    r.visibility === 0
                      ? 'text-[color:var(--color-muted)]/60'
                      : 'text-[color:var(--color-muted)]'
                  }`}
                >
                  {(r.visibility * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[color:var(--color-border)]/40 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    r.visibility === 0
                      ? 'bg-[color:var(--color-border)]'
                      : 'bg-[color:var(--color-accent)]'
                  }`}
                  style={{ width: `${(r.visibility / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {zero.length > 0 && covered.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full text-xs text-[color:var(--color-accent)] hover:underline pt-1"
        >
          {expanded
            ? `Hide ${zero.length} zero-coverage engine${zero.length === 1 ? '' : 's'}`
            : `Show ${zero.length} more · zero coverage (treatment headroom)`}
        </button>
      )}
    </section>
  );
}
