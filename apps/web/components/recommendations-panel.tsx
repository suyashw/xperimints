import { EmptyState } from './empty-state';

export interface Recommendation {
  title: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
  url?: string;
}

const PRIORITY_STYLE: Record<string, string> = {
  high: 'bg-red-100 text-red-900 ring-red-200',
  medium: 'bg-amber-100 text-amber-900 ring-amber-200',
  low: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
};

/**
 * RecommendationsPanel — typed render of the `get_actions` payload that lives
 * on `ExperimentResult.recommendations`. Sorted high → medium → low.
 *
 * "Peec speaks for itself" — PLAN.md §5.4 row 15.
 */
export function RecommendationsPanel({ items }: { items: ReadonlyArray<Recommendation> }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No recommendations yet"
        description="Once the experiment finalises, get_actions output is enriched here automatically."
      />
    );
  }
  const sorted = [...items].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
  );
  return (
    <ul className="space-y-2">
      {sorted.map((rec, i) => {
        const tone = PRIORITY_STYLE[rec.priority ?? 'medium'] ?? PRIORITY_STYLE['medium']!;
        const inner = (
          <>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${tone}`}
            >
              {rec.priority ?? 'medium'}
            </span>
            <div className="flex-1">
              <p className="font-medium text-sm">{rec.title}</p>
              {rec.description && (
                <p className="text-xs text-[color:var(--color-muted)] mt-0.5">
                  {rec.description}
                </p>
              )}
            </div>
          </>
        );
        return (
          <li
            key={i}
            className="flex items-start gap-3 rounded-md border border-[color:var(--color-border)] p-3"
          >
            {rec.url ? (
              <a
                href={rec.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-start gap-3 hover:underline"
              >
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
      <li className="text-[10px] text-[color:var(--color-muted)] uppercase tracking-wider mt-2">
        Source: <code>get_actions</code>
      </li>
    </ul>
  );
}

function priorityRank(p: string | undefined): number {
  switch (p) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
      return 2;
    default:
      return 1;
  }
}
