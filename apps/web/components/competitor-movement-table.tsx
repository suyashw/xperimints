import { formatPpDelta } from '@peec-lab/ui';
import { EmptyState } from './empty-state';

export interface CompetitorRow {
  brandId: string;
  brandName: string;
  sovDelta: number; // 0-1 ratio (e.g. -0.04 = -4pp)
  visibilityDelta: number; // 0-1 ratio
  citationDelta?: number; // 0-1 ratio (optional)
}

/**
 * CompetitorMovementTable — "who moved up/down during this experiment", from
 * the `competitorMovement` blob persisted on ExperimentResult (sourced from
 * list_brands + get_domain_report cross-referenced pre/post).
 *
 * Sorted by absolute SoV delta descending.
 */
export function CompetitorMovementTable({ rows }: { rows: ReadonlyArray<CompetitorRow> }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No tracked competitors moved"
        description="Either no tracked competitor changed measurably during the experiment window, or list_brands is still warming up."
      />
    );
  }
  const sorted = [...rows].sort((a, b) => Math.abs(b.sovDelta) - Math.abs(a.sovDelta));
  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="bg-[color:var(--color-border)]/30 text-xs uppercase text-[color:var(--color-muted)]">
          <tr>
            <th className="text-left p-2.5 font-medium">Competitor</th>
            <th className="text-right p-2.5 font-medium">Δ Share of voice</th>
            <th className="text-right p-2.5 font-medium">Δ Visibility</th>
            <th className="text-right p-2.5 font-medium">Δ Citation</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.brandId} className="border-t border-[color:var(--color-border)]">
              <td className="p-2.5 font-medium">{r.brandName}</td>
              <td
                className={`p-2.5 text-right tabular-nums ${
                  r.sovDelta > 0
                    ? 'text-emerald-700'
                    : r.sovDelta < 0
                      ? 'text-red-700'
                      : 'text-[color:var(--color-muted)]'
                }`}
              >
                {formatPpDelta(r.sovDelta)}
              </td>
              <td
                className={`p-2.5 text-right tabular-nums ${
                  r.visibilityDelta > 0
                    ? 'text-emerald-700'
                    : r.visibilityDelta < 0
                      ? 'text-red-700'
                      : 'text-[color:var(--color-muted)]'
                }`}
              >
                {formatPpDelta(r.visibilityDelta)}
              </td>
              <td className="p-2.5 text-right tabular-nums text-[color:var(--color-muted)]">
                {r.citationDelta === undefined ? '—' : formatPpDelta(r.citationDelta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-[color:var(--color-muted)] uppercase tracking-wider px-3 py-2 border-t border-[color:var(--color-border)]">
        Source: <code>list_brands</code> + <code>get_domain_report</code>
      </p>
    </div>
  );
}
