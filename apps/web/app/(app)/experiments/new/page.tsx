import Link from 'next/link';
import { analyzePromptHypothesis } from '@/app/actions/prompt-hypothesis';
import { recordImplementExperiment } from '@/app/actions/experiments';
import { ExperimentImplementer } from '@/components/experiment-implementer';

export const dynamic = 'force-dynamic';

interface SearchParams {
  prompt_id?: string;
}

/**
 * /experiments/new — the page the dashboard's prompt-inspector hands off
 * to when the user clicks "Implement experiment".
 *
 * Two render branches:
 *
 *   1. With `?prompt_id=…` (the hand-off path):
 *      Re-runs `analyzePromptHypothesis` server-side. The API serves from
 *      the PromptHypothesisCache row written by the dashboard modal, so
 *      this is one Prisma round-trip — *not* a fresh OpenAI / Peec MCP
 *      call. We use the cached payload as the source of truth instead of
 *      relying on URL query params (those were lossy: no engine
 *      breakdown, no overall visibility, no research bundle). The new
 *      ExperimentImplementer needs all of that data to render its four
 *      sections.
 *
 *   2. Without `prompt_id` (the cold path):
 *      Show the static templates list — the same fallback that shipped
 *      before the inspector hand-off existed.
 *
 * If the analyze call errors (e.g. cache row was wiped, demo org missing)
 * we render a small inline diagnostic with a link back to the dashboard
 * rather than a 500 — the user is mid-flow and a hard error here would
 * lose the context they just selected.
 */
export default async function NewExperimentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const promptId = sp.prompt_id?.trim() || null;

  return (
    <div className="mx-auto max-w-3xl p-10 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {promptId ? 'Implement experiment' : 'New experiment'}
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mt-1">
          {promptId
            ? 'Review the analysis and the AI-recommended actions below, then ship them on the target page (or A/B-test the highest-priority one against the control).'
            : 'Pick a starting point — open the dashboard, click an under-performing prompt, and hit Implement experiment to land here with a structured action plan tailored to that prompt.'}
        </p>
      </header>

      {promptId ? (
        <ImplementForPromptBranch promptId={promptId} />
      ) : (
        <ColdStartBranch />
      )}
    </div>
  );
}

async function ImplementForPromptBranch({ promptId }: { promptId: string }) {
  const result = await analyzePromptHypothesis(promptId, { force: false });

  if (!result.ok) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-5 space-y-2">
        <h2 className="font-medium">Could not load this hypothesis</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          {result.error}
        </p>
        <p className="text-sm text-[color:var(--color-muted)]">
          Try clicking the prompt again from the dashboard, or run a Peec
          refresh from the dashboard panel.
        </p>
        <Link
          href="/dashboard#prompt-visibility"
          className="inline-block text-sm underline mt-1"
        >
          ← Back to prompts
        </Link>
      </section>
    );
  }

  // Record the "Implement experiment" hand-off in the Experiments table
  // so it surfaces on /experiments. Idempotent server-side, so this is
  // safe on every reload — the recorded summary the API returns flips
  // `created` between "freshly inserted" and "already existed" and the
  // banner below adapts its copy accordingly.
  //
  // We deliberately await this in series with `analyzePromptHypothesis`
  // (rather than in parallel) because the API needs the cache row that
  // analyze() writes — running them in parallel would race the cache
  // upsert and could 404 on the very first hand-off for a prompt.
  const recorded = await recordImplementExperiment(promptId);

  return (
    <>
      <RecordBanner result={recorded} />
      <ExperimentImplementer data={result.data} />
    </>
  );
}

function RecordBanner({
  result,
}: {
  result: Awaited<ReturnType<typeof recordImplementExperiment>>;
}) {
  if (!result.ok) {
    return (
      <section className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-900">
        Could not auto-record this hand-off as a draft experiment:{' '}
        {result.error}. The analysis below still works — try refreshing the
        page once the issue is resolved.
      </section>
    );
  }
  const exp = result.data;
  return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 font-medium bg-emerald-100 text-emerald-900">
          {exp.created ? 'Recorded' : 'Tracking'}
        </span>
        <span className="text-emerald-900 truncate">
          {exp.created
            ? 'Saved this hand-off as a draft experiment.'
            : 'A draft for this prompt already exists.'}
        </span>
      </div>
      <Link
        href={`/experiments/${exp.id}`}
        className="text-xs font-medium text-emerald-900 underline whitespace-nowrap"
      >
        View on /experiments →
      </Link>
    </section>
  );
}

function ColdStartBranch() {
  return (
    <>
      <section className="rounded-lg border border-[color:var(--color-border)] p-5 space-y-3">
        <h2 className="font-medium">Common intervention patterns</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          The AI plan you&apos;ll see when you arrive here from a prompt
          composes a tailored mix of these patterns.
        </p>
        <ul className="text-sm space-y-1.5 list-disc pl-5">
          <li>Listicle rewrite — FAQ block + comparison table</li>
          <li>Product-comparison hub page</li>
          <li>JSON-LD schema markup (FAQPage / Product / Article)</li>
          <li>&ldquo;Best X for Y&rdquo; ghost-prompt expansion</li>
          <li>Author bios + primary-source citations</li>
        </ul>
      </section>

      <section className="rounded-lg border border-dashed border-[color:var(--color-border)] p-5">
        <p className="text-sm text-[color:var(--color-muted)]">
          Tip: open{' '}
          <Link
            href="/dashboard#prompt-visibility"
            className="underline text-[color:var(--color-fg)]"
          >
            the dashboard
          </Link>
          , click an under-performing prompt, then hit{' '}
          <strong>Implement experiment</strong> to land here pre-filled with
          the full analysis, hypothesis, a structured action plan, and the
          research behind the recommendation.
        </p>
      </section>

      <Link
        href="/experiments"
        className="inline-block text-sm text-[color:var(--color-muted)] underline"
      >
        ← Back to experiments
      </Link>
    </>
  );
}
