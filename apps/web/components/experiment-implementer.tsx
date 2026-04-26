'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type {
  ActionEffort,
  ActionGeneration,
  ActionItem,
  ActionKind,
  ActionPriority,
  EngineRow,
  PromptHypothesisResult,
  ResearchCitation,
} from '@/app/actions/prompt-hypothesis';
import { generateActionContent } from '@/app/actions/prompt-hypothesis';

/**
 * /experiments/new — the "Implement experiment" page.
 *
 * Four scannable sections:
 *
 *   1. Current analysis  — engine breakdown bars + overall visibility, so
 *                          the user sees the *signal* the hypothesis is
 *                          built on without flipping back to the
 *                          dashboard modal.
 *   2. Hypothesis & treatment — the AI's diagnosis and recommended fix,
 *                          each in their own copy-able card.
 *   3. Recommended actions — the structured AI action plan. Each card is
 *                          one concrete content intervention (FAQ block,
 *                          blog post, schema markup, page rewrite, …)
 *                          with priority/effort badges, expected impact,
 *                          step-by-step checklist, and example content.
 *                          Replaces the previous "experiment.yaml +
 *                          starter PR" flow — the canonical path is now
 *                          to ship the recommended actions directly,
 *                          not to commit a YAML file.
 *   4. Research          — a "View research" button that opens a modal
 *                          with the reasoning narrative and the curated
 *                          citations the API picked from its closed
 *                          library.
 *
 * `use client` because we need: the editable experiment name (cosmetic
 * label only — drives nothing else now that YAML is gone), per-button
 * "Copied!" affordance, and the research-modal open/close + scroll-lock
 * side effects.
 */
export function ExperimentImplementer({
  data,
}: {
  data: PromptHypothesisResult;
}) {
  const [name, setName] = useState(data.suggestedExperimentName);
  const [showResearch, setShowResearch] = useState(false);

  return (
    <div className="space-y-6">
      <HeroCard
        name={name}
        onName={setName}
        promptText={data.promptText}
        source={data.source}
        cached={data.cached}
        computedAt={data.computedAt}
        onOpenResearch={() => setShowResearch(true)}
        researchCount={data.research.citations.length}
      />

      <CurrentAnalysisSection
        overallVisibility={data.overallVisibility}
        engineBreakdown={data.engineBreakdown}
        weakEngines={data.weakEngines}
        strongEngines={data.strongEngines}
      />

      <HypothesisAndTreatmentSection
        hypothesis={data.hypothesis}
        recommendedTreatment={data.recommendedTreatment}
      />

      <ActionPlanSection
        promptId={data.promptId}
        actionPlan={data.actionPlan}
        source={data.source}
        recommendedMinLiftPp={data.recommendedMinLiftPp}
        initialGenerations={data.generations}
      />

      <Link
        href="/dashboard#prompt-visibility"
        className="inline-block text-sm text-[color:var(--color-muted)] underline"
      >
        ← Back to prompts
      </Link>

      {showResearch && (
        <ResearchModal
          research={data.research}
          source={data.source}
          onClose={() => setShowResearch(false)}
        />
      )}
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────── */

function HeroCard({
  name,
  onName,
  promptText,
  source,
  cached,
  computedAt,
  onOpenResearch,
  researchCount,
}: {
  name: string;
  onName: (v: string) => void;
  promptText: string | null;
  source: 'openai' | 'heuristic';
  cached: boolean;
  computedAt: string;
  onOpenResearch: () => void;
  researchCount: number;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-accent)] font-medium">
          From prompt inspector
        </span>
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
          via {source === 'openai' ? 'OpenAI' : 'heuristic'} ·{' '}
          {cached ? 'cached' : 'fresh'} · last analyzed{' '}
          {formatRelative(computedAt)}
        </span>
      </div>

      <div>
        <label
          className="block text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1"
          htmlFor="exp-name"
        >
          Experiment name
        </label>
        <input
          id="exp-name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          className="w-full text-xl font-semibold tracking-tight bg-transparent border-b border-[color:var(--color-border)] focus:border-[color:var(--color-accent)] focus:outline-none py-1"
        />
      </div>

      {promptText && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
            Targeted prompt
          </div>
          <p className="text-sm leading-snug">&ldquo;{promptText}&rdquo;</p>
        </div>
      )}

      <div className="pt-1">
        <button
          type="button"
          onClick={onOpenResearch}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--color-border)]/30 cursor-pointer"
        >
          View research ({researchCount} citations) →
        </button>
      </div>
    </section>
  );
}

/* ── 1. Current analysis ─────────────────────────────────────────────── */

function CurrentAnalysisSection({
  overallVisibility,
  engineBreakdown,
  weakEngines,
  strongEngines,
}: {
  overallVisibility: number | null;
  engineBreakdown: EngineRow[];
  weakEngines: string[];
  strongEngines: string[];
}) {
  return (
    <section className="rounded-lg border border-[color:var(--color-border)] p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
          1. Current analysis
        </h2>
        <span className="text-[11px] text-[color:var(--color-muted)]">
          Last 14 days · own brand
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Overall visibility"
          value={
            overallVisibility != null
              ? `${(overallVisibility * 100).toFixed(1)}%`
              : '—'
          }
          accent
        />
        <Stat label="Strong engines" value={String(strongEngines.length)} />
        <Stat label="Weak engines" value={String(weakEngines.length)} />
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
          Engine breakdown
        </div>
        {engineBreakdown.length > 0 ? (
          <EngineBars
            rows={engineBreakdown}
            weak={weakEngines}
            strong={strongEngines}
          />
        ) : (
          <p className="text-sm text-[color:var(--color-muted)]">
            No per-engine data available for this prompt yet.
          </p>
        )}
      </div>
    </section>
  );
}

function EngineBars({
  rows,
  weak,
  strong,
}: {
  rows: EngineRow[];
  weak: string[];
  strong: string[];
}) {
  const max = Math.max(...rows.map((r) => r.visibility), 0.0001);
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const isWeak = weak.includes(r.model_id);
        const isStrong = strong.includes(r.model_id);
        return (
          <li key={r.model_id} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <code className="text-xs flex items-center gap-1.5">
                {r.model_id}
                {isStrong && (
                  <span className="text-[9px] uppercase tracking-wider rounded px-1 py-px bg-emerald-100 text-emerald-900">
                    strong
                  </span>
                )}
                {isWeak && (
                  <span className="text-[9px] uppercase tracking-wider rounded px-1 py-px bg-amber-100 text-amber-900">
                    weak
                  </span>
                )}
              </code>
              <span className="tabular-nums text-xs text-[color:var(--color-muted)]">
                {(r.visibility * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[color:var(--color-border)]/40 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  r.visibility === 0
                    ? 'bg-[color:var(--color-border)]'
                    : isWeak
                      ? 'bg-amber-500/70'
                      : isStrong
                        ? 'bg-emerald-500/70'
                        : 'bg-[color:var(--color-accent)]'
                }`}
                style={{ width: `${(r.visibility / max) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-[color:var(--color-border)] p-3 bg-white">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          accent ? 'text-[color:var(--color-accent)]' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* ── 2. Hypothesis & treatment ───────────────────────────────────────── */

function HypothesisAndTreatmentSection({
  hypothesis,
  recommendedTreatment,
}: {
  hypothesis: string;
  recommendedTreatment: string;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--color-border)] p-5 space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
        2. Hypothesis & treatment
      </h2>
      <CopyCard label="Hypothesis" value={hypothesis} />
      <CopyCard label="Recommended treatment" value={recommendedTreatment} />
    </section>
  );
}

function CopyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-border)]/15 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
          {label}
        </div>
        <CopyButton value={value} />
      </div>
      <p className="text-sm leading-relaxed">{value}</p>
    </div>
  );
}

/* ── 3. Recommended actions ──────────────────────────────────────────── */

/**
 * Per-kind metadata used to render the action card header. Keeps the
 * card UI consistent across kinds while letting each one carry its own
 * label + accent class. Adding a new kind is a one-line entry here plus
 * the matching addition to `ALLOWED_ACTION_KINDS` in the API service.
 */
const KIND_META: Record<
  ActionKind,
  { label: string; tone: string }
> = {
  faq: { label: 'FAQ block', tone: 'bg-sky-100 text-sky-900' },
  blog: { label: 'Blog post', tone: 'bg-violet-100 text-violet-900' },
  content_update: {
    label: 'Page rewrite',
    tone: 'bg-amber-100 text-amber-900',
  },
  schema_markup: {
    label: 'Schema markup',
    tone: 'bg-emerald-100 text-emerald-900',
  },
  comparison_table: {
    label: 'Comparison table',
    tone: 'bg-indigo-100 text-indigo-900',
  },
  citations: {
    label: 'Primary citations',
    tone: 'bg-rose-100 text-rose-900',
  },
  new_landing_page: {
    label: 'New landing page',
    tone: 'bg-fuchsia-100 text-fuchsia-900',
  },
  internal_linking: {
    label: 'Internal linking',
    tone: 'bg-teal-100 text-teal-900',
  },
  author_bio: {
    label: 'Author / E-E-A-T',
    tone: 'bg-lime-100 text-lime-900',
  },
  other: { label: 'Other', tone: 'bg-zinc-100 text-zinc-900' },
};

const PRIORITY_TONE: Record<ActionPriority, string> = {
  high: 'bg-red-100 text-red-900 border-red-200',
  medium: 'bg-amber-100 text-amber-900 border-amber-200',
  low: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

const EFFORT_TONE: Record<ActionEffort, string> = {
  small: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  medium: 'bg-sky-50 text-sky-800 border-sky-200',
  large: 'bg-purple-50 text-purple-800 border-purple-200',
};

export function ActionPlanSection({
  promptId,
  actionPlan,
  source,
  recommendedMinLiftPp,
  initialGenerations,
}: {
  promptId: string;
  actionPlan: ActionItem[];
  source: 'openai' | 'heuristic';
  recommendedMinLiftPp: number;
  initialGenerations: Record<string, ActionGeneration>;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--color-border)] p-5 space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)]">
          3. Recommended actions
        </h2>
        <span className="text-[11px] text-[color:var(--color-muted)]">
          {actionPlan.length} action{actionPlan.length === 1 ? '' : 's'} ·
          ordered by priority · target ≥ {recommendedMinLiftPp}pp lift
        </span>
      </div>

      <p className="text-xs text-[color:var(--color-muted)] leading-relaxed">
        These are the concrete content interventions the{' '}
        {source === 'openai' ? 'AI' : 'heuristic'} recommends shipping for
        this prompt. Hit <strong>Generate</strong> on any card to draft the
        actual content (FAQ Q&amp;As, blog post, JSON-LD, comparison table,
        …) — generations are saved against this prompt so reloads keep your
        drafts.
      </p>

      {actionPlan.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">
          No actions were generated for this prompt yet — try{' '}
          <strong>Re-analyze</strong> from the dashboard.
        </p>
      ) : (
        <ol className="space-y-4">
          {actionPlan.map((action, i) => (
            <ActionCard
              key={action.id}
              action={action}
              index={i}
              promptId={promptId}
              initialGeneration={initialGenerations[action.id] ?? null}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ActionCard({
  action,
  index,
  promptId,
  initialGeneration,
}: {
  action: ActionItem;
  index: number;
  promptId: string;
  initialGeneration: ActionGeneration | null;
}) {
  const meta = KIND_META[action.kind] ?? KIND_META.other;
  const copyValue = renderActionForCopy(action);
  // Local state mirrors the persisted generation. Initialised from the
  // hydrated server result so a reload immediately shows previously
  // generated content without an extra round-trip.
  const [generation, setGeneration] = useState<ActionGeneration | null>(
    initialGeneration,
  );
  const [error, setError] = useState<string | null>(null);
  // useTransition gives us pending state without blocking the rest of
  // the page; the API call is server-side via the action so React
  // schedules it and we just observe the boolean.
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await generateActionContent(promptId, action.id);
      if (res.ok) {
        setGeneration(res.data);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <li className="rounded-md border border-[color:var(--color-border)] bg-white p-4 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--color-border)]/60 px-1.5 text-[10px] font-semibold tabular-nums">
              {index + 1}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 font-medium ${meta.tone}`}
            >
              {meta.label}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${PRIORITY_TONE[action.priority]}`}
              title="Priority"
            >
              {action.priority} priority
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 font-medium ${EFFORT_TONE[action.effort]}`}
              title="Estimated effort"
            >
              {action.effort} effort
            </span>
          </div>
          <h3 className="text-base font-semibold leading-snug">
            {action.title}
          </h3>
        </div>
        <CopyButton value={copyValue} />
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        <MetaRow label="Expected impact" value={action.expectedImpact} />
        {action.target && <MetaRow label="Target" value={action.target} mono />}
      </div>

      <p className="text-sm leading-relaxed">{action.description}</p>

      {action.steps.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1.5">
            Steps
          </div>
          <ul className="space-y-1.5">
            {action.steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug">
                <span
                  className="flex-shrink-0 mt-1 h-3 w-3 rounded-sm border border-[color:var(--color-border)]"
                  aria-hidden
                />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {action.examples && action.examples.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1.5">
            Examples
          </div>
          <ul className="space-y-1.5">
            {action.examples.map((ex, i) => (
              <li
                key={i}
                className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-border)]/15 px-2.5 py-1.5 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words"
              >
                {ex}
              </li>
            ))}
          </ul>
        </div>
      )}

      {generation && (
        <GeneratedContent
          generation={generation}
          isRegenerating={isPending}
        />
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-[color:var(--color-border)]/60">
        {generation && !isPending && (
          <span className="text-[10px] text-[color:var(--color-muted)] mr-auto">
            Last generated {formatRelative(generation.updatedAt)} · saved
          </span>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-accent-fg)] hover:opacity-90 disabled:opacity-60 disabled:cursor-wait cursor-pointer"
        >
          {isPending
            ? 'Generating…'
            : generation
              ? 'Regenerate'
              : 'Generate'}
        </button>
      </div>
    </li>
  );
}

/**
 * Renders the AI-generated body for an action card. Uses a mono `<pre>`
 * for JSON output (so JSON-LD snippets line up) and wrapped prose for
 * markdown / text. The "Copy" button copies the raw body verbatim so
 * the user can paste it straight into a CMS.
 */
function GeneratedContent({
  generation,
  isRegenerating,
}: {
  generation: ActionGeneration;
  isRegenerating: boolean;
}) {
  const isJson = generation.format === 'json';
  return (
    <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-wider font-medium text-emerald-900">
          Generated content
          <span className="ml-1.5 normal-case font-normal text-emerald-800">
            · {generation.format}
          </span>
        </div>
        <CopyButton value={generation.content} />
      </div>
      <pre
        className={`max-h-80 overflow-auto rounded bg-white border border-emerald-100 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words ${
          isJson ? 'font-mono' : ''
        } ${isRegenerating ? 'opacity-50' : ''}`}
      >
        {generation.content}
      </pre>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-border)]/10 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className={`text-xs ${mono ? 'font-mono' : ''} truncate`} title={value}>
        {value}
      </div>
    </div>
  );
}

/**
 * Build a plain-text representation of an ActionItem for the per-card
 * "Copy" button so the user can paste a brief into Notion / Linear /
 * email without losing the structured fields. Kept human-readable, not
 * machine-parseable — this is meant for humans to read.
 */
function renderActionForCopy(a: ActionItem): string {
  const lines: string[] = [];
  lines.push(`# ${a.title}`);
  lines.push('');
  lines.push(
    `Kind: ${KIND_META[a.kind]?.label ?? a.kind}  ·  Priority: ${a.priority}  ·  Effort: ${a.effort}`,
  );
  lines.push(`Expected impact: ${a.expectedImpact}`);
  if (a.target) lines.push(`Target: ${a.target}`);
  lines.push('');
  lines.push(a.description);
  if (a.steps.length > 0) {
    lines.push('');
    lines.push('Steps:');
    for (const s of a.steps) lines.push(`- [ ] ${s}`);
  }
  if (a.examples && a.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    for (const e of a.examples) lines.push(`- ${e}`);
  }
  return lines.join('\n');
}

/* ── 4. Research modal ───────────────────────────────────────────────── */

function ResearchModal({
  research,
  source,
  onClose,
}: {
  research: PromptHypothesisResult['research'];
  source: 'openai' | 'heuristic';
  onClose: () => void;
}) {
  // Esc to close + scroll lock + first-render focus parity with the
  // prompt-inspector modal on the dashboard, so the two modals feel like
  // one consistent UI surface even though they live in different files.
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Research behind the hypothesis"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl border border-[color:var(--color-border)]">
        <div className="sticky top-0 bg-white border-b border-[color:var(--color-border)] px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
              Research behind this hypothesis
            </div>
            <h2 className="font-medium text-base">
              Reasoning chain & citations
            </h2>
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

        <div className="p-5 space-y-6">
          <section>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-2 flex items-center gap-2">
              <span>Reasoning</span>
              <span className="text-[10px] normal-case tracking-normal text-[color:var(--color-muted)]">
                · {source === 'openai' ? 'generated by OpenAI' : 'deterministic heuristic'}
              </span>
            </div>
            {research.narrative.length === 0 ? (
              <p className="text-sm text-[color:var(--color-muted)]">
                No reasoning narrative was produced for this hypothesis.
              </p>
            ) : (
              <ol className="space-y-3">
                {research.narrative.map((p, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--color-border)]/60 text-[10px] font-semibold tabular-nums">
                      {i + 1}
                    </span>
                    <p className="text-sm leading-relaxed">{p}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
              Citations ({research.citations.length})
            </div>
            {research.citations.length === 0 ? (
              <p className="text-sm text-[color:var(--color-muted)]">
                No citations were attached to this hypothesis.
              </p>
            ) : (
              <ul className="space-y-3">
                {research.citations.map((c) => (
                  <CitationItem key={c.tag} citation={c} />
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-[color:var(--color-muted)] border-t border-[color:var(--color-border)] pt-3">
            Citations are picked from a curated GEO source library — never
            from open web search — so every link in this list is a real,
            primary or first-tier reference. The reasoning narrative above
            applies that library to your project&apos;s engine breakdown.
          </p>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[color:var(--color-border)] px-5 py-3 flex items-center justify-end">
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

function CitationItem({ citation }: { citation: ResearchCitation }) {
  return (
    <li className="rounded-md border border-[color:var(--color-border)] p-3 space-y-1.5 bg-[color:var(--color-border)]/10">
      <div className="flex items-baseline justify-between gap-3">
        <a
          href={citation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline"
        >
          {citation.title}
        </a>
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] whitespace-nowrap">
          {citation.domain}
        </span>
      </div>
      <p className="text-xs text-[color:var(--color-muted)] leading-relaxed">
        {citation.note}
      </p>
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-mono text-[color:var(--color-accent)] hover:underline break-all"
      >
        {citation.url}
      </a>
    </li>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/**
 * Tiny clipboard button with a 1.5s "Copied!" affordance. Falls back to
 * a noop on environments without `navigator.clipboard` (e.g. the
 * server-side render before hydration) — the button is a no-op there
 * rather than throwing.
 */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Some browsers reject clipboard writes outside a user gesture or
      // without focus — silently swallow; the affordance just won't flip.
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      className={`inline-flex items-center gap-1 rounded border border-[color:var(--color-border)] bg-white px-2 py-1 text-[11px] font-medium hover:bg-[color:var(--color-border)]/30 cursor-pointer ${
        copied ? 'text-emerald-700 border-emerald-300' : ''
      }`}
      aria-label={label ?? 'Copy'}
      title={label ?? 'Copy'}
    >
      {copied ? 'Copied!' : (label ?? 'Copy')}
    </button>
  );
}

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
