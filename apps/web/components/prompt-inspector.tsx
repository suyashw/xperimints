'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  analyzePromptHypothesis,
  type EngineRow,
  type PromptHypothesisResult,
} from '@/app/actions/prompt-hypothesis';

/**
 * Two coupled UI pieces, kept in one client component so they can share the
 * modal state and the in-flight transition without prop drilling:
 *
 *   1. <PromptList> — replaces the static list inside PromptVisibilityCard.
 *      Each row becomes a button; clicking it opens the inspector modal.
 *
 *   2. <PromptInspectorModal> — fetches the per-prompt engine breakdown
 *      and AI-generated hypothesis via `analyzePromptHypothesis`. Two CTAs:
 *      "Re-analyze" (forces a fresh recompute) and "Implement experiment"
 *      (links to /experiments/new with the relevant fields prefilled in
 *      the query string so the create page can pre-populate them).
 *
 * The hypothesis call is kicked off on modal-open — but the API caches
 * results in `PromptHypothesisCache` keyed by (org, promptId), so the
 * second open of the same prompt is served from the cache (no Peec MCP /
 * OpenAI roundtrip). Only the "Re-analyze" button bypasses the cache by
 * passing `force: true` to the server action.
 */

interface PromptRow {
  prompt_id: string;
  visibility: number;
}

interface ListProps {
  title: string;
  rows: PromptRow[];
  /**
   * Drives the visibility-percentage colour:
   *   - positive → green (top performers, candidate control prompts)
   *   - negative → amber (under-performers, candidate treatment prompts)
   *   - neutral  → muted (mid-range; nothing actionable to highlight)
   */
  accent: 'positive' | 'negative' | 'neutral';
  promptTextById: Record<string, string>;
}

export function ClickablePromptList({
  title,
  rows,
  accent,
  promptTextById,
}: ListProps) {
  const [active, setActive] = useState<PromptRow | null>(null);

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
        {title}
      </div>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => {
          const text = promptTextById[r.prompt_id];
          return (
            <li key={r.prompt_id}>
              <button
                type="button"
                onClick={() => setActive(r)}
                className="group w-full text-left flex items-start justify-between gap-3 border-b border-dashed border-[color:var(--color-border)]/60 pb-2 last:border-0 hover:bg-[color:var(--color-border)]/15 -mx-1 px-1 rounded transition-colors cursor-pointer"
                title="Click to inspect engine breakdown and run a hypothesis"
              >
                <span className="text-xs leading-snug line-clamp-2 flex-1 group-hover:underline decoration-dotted underline-offset-2">
                  {text ?? <span className="italic text-[color:var(--color-muted)]">Untitled prompt</span>}
                </span>
                <span
                  className={`tabular-nums text-xs whitespace-nowrap ${
                    accent === 'positive'
                      ? 'text-emerald-700'
                      : accent === 'negative'
                        ? 'text-amber-700'
                        : 'text-[color:var(--color-muted)]'
                  }`}
                >
                  {(r.visibility * 100).toFixed(1)}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {active && (
        <PromptInspectorModal
          prompt={active}
          promptText={promptTextById[active.prompt_id]}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function PromptInspectorModal({
  prompt,
  promptText,
  onClose,
}: {
  prompt: PromptRow;
  promptText: string | undefined;
  onClose: () => void;
}) {
  const [data, setData] = useState<PromptHypothesisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Two distinct entry points share this function:
  //
  //   * Modal open (force=false) — the API will return the cached row if
  //     one exists, so the second open of the same prompt is effectively
  //     instant. Only the very first open pays the Peec MCP + OpenAI cost.
  //
  //   * "Re-analyze" button (force=true) — bypasses the cache, recomputes,
  //     and overwrites the row.
  //
  // Clearing `data`/`error` synchronously before starting the transition
  // is what makes Re-analyze actually feel like a re-analyze: without it,
  // the previous hypothesis stays painted on screen for the entire
  // round-trip and the only feedback is a button label change. Resetting
  // here flips the render branches back to the skeleton state — the same
  // state the modal shows on initial open — and the new payload replaces
  // it when `analyzePromptHypothesis` resolves.
  const runAnalysis = (force: boolean) => {
    setData(null);
    setError(null);
    startTransition(async () => {
      const result = await analyzePromptHypothesis(prompt.prompt_id, { force });
      if (result.ok) {
        setData(result.data);
      } else {
        setError(result.error);
        setData(null);
      }
    });
  };

  useEffect(() => {
    // Open path uses the cache; only Re-analyze should bypass it.
    runAnalysis(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt.prompt_id]);

  // Esc-to-close + scroll lock — small things that make the modal feel
  // like an actual modal and not a styled div.
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

  const subject = promptText ?? 'Untitled prompt';
  const implementHref = data
    ? buildImplementHref(prompt.prompt_id, data)
    : `/experiments/new?prompt_id=${encodeURIComponent(prompt.prompt_id)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Prompt inspector"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl border border-[color:var(--color-border)]">
        <div className="sticky top-0 bg-white border-b border-[color:var(--color-border)] px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
              Prompt inspector
            </div>
            <h2 className="font-medium text-base leading-snug">{subject}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--color-muted)] hover:text-black p-1 -mr-1 cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section>
            <SectionTitle>Engine breakdown</SectionTitle>
            <p className="text-xs text-[color:var(--color-muted)] mt-0.5 mb-3">
              Per-engine visibility for your brand on this prompt — last 14 days.
            </p>
            {isPending && !data ? (
              <SkeletonBars />
            ) : data && data.engineBreakdown.length > 0 ? (
              <EngineBars rows={data.engineBreakdown} />
            ) : (
              <p className="text-sm text-[color:var(--color-muted)]">
                {data
                  ? 'No per-engine data returned for this prompt.'
                  : '—'}
              </p>
            )}
          </section>

          <section>
            <SectionTitle>
              Hypothesis
              {data && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] font-normal">
                  via {data.source === 'openai' ? 'OpenAI' : 'heuristic'}
                  {' · '}
                  {data.cached ? 'cached' : 'fresh'} · last analyzed{' '}
                  {formatRelative(data.computedAt)}
                </span>
              )}
            </SectionTitle>
            {isPending && !data ? (
              <SkeletonText />
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                {error}
              </div>
            ) : data ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed">{data.hypothesis}</p>
                <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-border)]/15 p-3">
                  <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
                    Recommended treatment
                  </div>
                  <p className="text-sm leading-relaxed">
                    {data.recommendedTreatment}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <Field
                    label="Min lift to target"
                    value={`${data.recommendedMinLiftPp}pp`}
                  />
                  <Field
                    label="Weak engines"
                    value={
                      data.weakEngines.length > 0
                        ? data.weakEngines.join(', ')
                        : '—'
                    }
                  />
                </dl>
              </div>
            ) : null}
          </section>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[color:var(--color-border)] px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => runAnalysis(true)}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]/30 disabled:opacity-60 disabled:cursor-wait cursor-pointer"
            title="Bypass the cached hypothesis and recompute from the latest Peec data"
          >
            {isPending ? 'Re-analyzing…' : 'Re-analyze'}
          </button>
          <Link
            href={implementHref}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[color:var(--color-accent-fg)] hover:opacity-90"
          >
            Implement experiment →
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * "5m ago", "3h ago", "2d ago" — small enough that pulling in a date
 * library for it would be a bigger footgun than the imprecision. Falls
 * back to a locale string for anything older than a week, since at that
 * point the user wants the absolute date anyway.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function buildImplementHref(promptId: string, h: PromptHypothesisResult): string {
  const params = new URLSearchParams();
  params.set('prompt_id', promptId);
  params.set('name', h.suggestedExperimentName);
  params.set('hypothesis', h.hypothesis);
  params.set('treatment', h.recommendedTreatment);
  params.set('min_lift_pp', String(h.recommendedMinLiftPp));
  if (h.weakEngines.length > 0) {
    params.set('engines', h.weakEngines.join(','));
  }
  return `/experiments/new?${params.toString()}`;
}

function EngineBars({ rows }: { rows: EngineRow[] }) {
  const max = Math.max(...rows.map((r) => r.visibility), 0.0001);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.model_id} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <code className="text-xs">{r.model_id}</code>
            <span className="tabular-nums text-xs text-[color:var(--color-muted)]">
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
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
      {children}
    </h3>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </dt>
      <dd className="font-medium text-sm">{value}</dd>
    </div>
  );
}

function SkeletonBars() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2].map((i) => (
        <li key={i} className="space-y-1">
          <div className="h-3 w-24 rounded bg-[color:var(--color-border)]/40 animate-pulse" />
          <div className="h-1.5 w-full rounded-full bg-[color:var(--color-border)]/30 animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function SkeletonText() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-full rounded bg-[color:var(--color-border)]/40 animate-pulse" />
      <div className="h-3 w-5/6 rounded bg-[color:var(--color-border)]/40 animate-pulse" />
      <div className="h-3 w-4/6 rounded bg-[color:var(--color-border)]/40 animate-pulse" />
    </div>
  );
}
