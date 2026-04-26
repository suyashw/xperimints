import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getCumulativeLiftSeries,
  getCurrentOrg,
  getDashboardSummary,
  listExperimentsForOrg,
} from '@/lib/data';

export const dynamic = 'force-dynamic';
import { CumulativeLiftChart } from '@/components/cumulative-lift-chart';
import {
  ExperimentsTable,
  type ExperimentTableRow,
} from '@/components/experiments-table';
import { formatPpDelta } from '@peec-lab/ui';

export default async function ExperimentsPage() {
  // No auto-sync. Page renders from the cached experiment rows written by
  // the last user-triggered Peec refresh on /dashboard.
  const org = await getCurrentOrg();
  if (!org) redirect('/dashboard');

  const [summary, experiments, cumulativeSeries] = await Promise.all([
    getDashboardSummary(org.id),
    listExperimentsForOrg(org.id),
    getCumulativeLiftSeries(org.id),
  ]);

  // Narrow the Prisma rows to the plain shape the client table needs.
  // Crossing the server/client boundary with the full ORM row pulls in
  // Date/JSON values we don't care about and inflates the payload; the
  // table only reads these specific fields anyway.
  const rows: ExperimentTableRow[] = experiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
    status: exp.status,
    treatmentUrl: exp.treatmentUrl,
    treatmentPromptIds: exp.treatmentPromptIds,
    hypothesis: exp.hypothesis,
    minLiftPp: exp.minLiftPp,
    isPublic: exp.isPublic,
    shareSlug: exp.shareSlug,
    liftByEngine: (exp.result?.liftByEngine ?? null) as ExperimentTableRow['liftByEngine'],
  }));

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
          <p className="text-sm text-[color:var(--color-muted)] mt-1">
            Every A/B run, the lift it produced, and how much you’ve banked YTD.
          </p>
        </div>
        <Link
          href="/dashboard#prompt-visibility"
          className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-accent)] px-3 py-2 text-sm font-medium text-[color:var(--color-accent-fg)]"
        >
          Create experiment
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active experiments" value={summary.activeCount.toString()} />
        <Stat label="Wins YTD" value={summary.winCount.toString()} />
        <Stat
          label="Cumulative pp gained"
          value={formatPpDelta(summary.cumulativePp / 100, 1)}
          accent
        />
      </section>

      <section className="rounded-lg border border-[color:var(--color-border)] p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Cumulative pp gained — YTD
        </h2>
        <CumulativeLiftChart data={cumulativeSeries} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-[color:var(--color-muted)] uppercase tracking-wider mb-3">
          All experiments
        </h2>
        <ExperimentsTable experiments={rows} />
      </section>
    </div>
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
    <div className="rounded-lg border border-[color:var(--color-border)] p-4">
      <div className="text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? 'text-[color:var(--color-accent)]' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
