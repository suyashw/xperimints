'use client';

import { useEffect, useState } from 'react';
import type { ExperimentStatus } from '@peec-lab/database';
import {
  analyzePromptHypothesis,
  type PromptHypothesisResult,
} from '@/app/actions/prompt-hypothesis';
import { ActionPlanSection } from './experiment-implementer';
import { ExperimentStatusPill } from './experiment-status-pill';

interface ExperimentForModal {
  id: string;
  name: string;
  status: ExperimentStatus;
  treatmentUrl: string;
  treatmentPromptIds: string[];
  minLiftPp: number;
  hypothesis: string;
}

/**
 * Modal that opens from the experiments list. Fetches the prompt
 * hypothesis for the experiment's first treatment prompt and renders
 * the same `ActionPlanSection` used on /experiments/new — so the user
 * can review (and re-generate) the AI's recommended content
 * interventions for any existing experiment without leaving the list.
 *
 * Pattern (Esc to close, scroll-lock, click-outside, sticky header)
 * mirrors `ResearchModal` in experiment-implementer.tsx so the two
 * surfaces feel consistent.
 */
export function ExperimentActionPlanModal({
  experiment,
  onClose,
}: {
  experiment: ExperimentForModal;
  onClose: () => void;
}) {
  const [data, setData] = useState<PromptHypothesisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const promptId = experiment.treatmentPromptIds[0];
    if (!promptId) {
      setError(
        'This experiment has no treatment prompt — recommended actions need a prompt to analyze.',
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    analyzePromptHypothesis(promptId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setData(res.data);
        } else {
          setError(res.error);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError((err as Error).message ?? 'Failed to load recommended actions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [experiment.treatmentPromptIds]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/40 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Recommended actions for ${experiment.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl my-auto rounded-lg bg-white shadow-xl border border-[color:var(--color-border)]">
        <div className="sticky top-0 z-10 bg-white border-b border-[color:var(--color-border)] px-5 py-4 flex items-start justify-between gap-4 rounded-t-lg">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <ExperimentStatusPill status={experiment.status} />
              <span className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)]">
                Min lift {experiment.minLiftPp}pp
              </span>
            </div>
            <h2 className="text-base font-semibold leading-snug truncate">
              {experiment.name}
            </h2>
            <div className="text-xs text-[color:var(--color-muted)] truncate">
              <a
                href={experiment.treatmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {experiment.treatmentUrl}
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--color-muted)] hover:text-black p-1 -mr-1 cursor-pointer flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          {experiment.hypothesis && (
            <section className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-border)]/15 p-3 text-sm leading-relaxed">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
                Hypothesis
              </div>
              <p className="text-sm">{experiment.hypothesis}</p>
            </section>
          )}

          {loading && <ActionPlanSkeleton />}

          {!loading && error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <ActionPlanSection
              promptId={data.promptId}
              actionPlan={data.actionPlan}
              source={data.source}
              recommendedMinLiftPp={data.recommendedMinLiftPp}
              initialGenerations={data.generations}
            />
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[color:var(--color-border)] px-5 py-3 flex items-center justify-end gap-2 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionPlanSkeleton() {
  return (
    <section className="rounded-lg border border-[color:var(--color-border)] p-5 space-y-5 animate-pulse">
      <div className="flex items-baseline justify-between gap-3">
        <div className="h-3 w-40 rounded bg-[color:var(--color-border)]/60" />
        <div className="h-3 w-32 rounded bg-[color:var(--color-border)]/60" />
      </div>
      <div className="h-3 w-3/4 rounded bg-[color:var(--color-border)]/60" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-md border border-[color:var(--color-border)] p-4 space-y-3"
          >
            <div className="flex gap-2">
              <div className="h-4 w-12 rounded bg-[color:var(--color-border)]/60" />
              <div className="h-4 w-20 rounded bg-[color:var(--color-border)]/60" />
              <div className="h-4 w-20 rounded bg-[color:var(--color-border)]/60" />
            </div>
            <div className="h-4 w-2/3 rounded bg-[color:var(--color-border)]/60" />
            <div className="h-3 w-full rounded bg-[color:var(--color-border)]/40" />
            <div className="h-3 w-5/6 rounded bg-[color:var(--color-border)]/40" />
          </div>
        ))}
      </div>
    </section>
  );
}
