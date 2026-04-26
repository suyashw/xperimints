import type { ReactNode } from 'react';

/**
 * PowerAnalysisCard — shows the "you'll detect ≥5pp with 82% power in 14
 * days" verdict from PowerAnalysisService. Color-coded:
 *   green if achievable at the user's settings
 *   amber if borderline (≥0.6 power but <0.8 at the cap)
 *   red   if blocked (power < 0.6 at the cap)
 */
export function PowerAnalysisCard({
  power,
  recommendedDays,
  block,
  achievable,
  message,
  minLiftPp,
  action,
}: {
  power: number;
  recommendedDays: number | null;
  block: boolean;
  achievable: boolean;
  message: string;
  minLiftPp: number;
  action?: ReactNode;
}) {
  const tone = block ? 'red' : achievable ? 'green' : 'amber';
  const ring =
    tone === 'green'
      ? 'ring-emerald-300 bg-emerald-50/40'
      : tone === 'amber'
        ? 'ring-amber-300 bg-amber-50/40'
        : 'ring-red-300 bg-red-50/40';
  const headline =
    tone === 'green'
      ? `Powered to detect ≥${minLiftPp}pp`
      : tone === 'amber'
        ? `Borderline power for ≥${minLiftPp}pp`
        : `Underpowered for ≥${minLiftPp}pp — blocked`;
  return (
    <div className={`rounded-lg ring-1 ${ring} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
            Power analysis
          </div>
          <div className="mt-0.5 font-medium">{headline}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tabular-nums">
            {(power * 100).toFixed(0)}
            <span className="text-sm font-normal text-[color:var(--color-muted)]">%</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
            statistical power
          </div>
        </div>
      </div>
      <p className="text-sm text-[color:var(--color-muted)]">{message}</p>
      <div className="flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
        <span>
          <span className="text-[color:var(--color-fg)] font-medium">
            {recommendedDays ? `${recommendedDays} days` : '— days'}
          </span>{' '}
          recommended
        </span>
        <span>·</span>
        <span>
          α = 0.05 · 10k permutations · Bonferroni
        </span>
      </div>
      {action}
    </div>
  );
}
