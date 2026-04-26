import type { ReactNode } from 'react';

/**
 * EmptyState — used wherever data hasn't arrived yet (Peec 24h latency,
 * pre-launch experiments, empty experiments table, etc.).
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[color:var(--color-border)] p-8 text-center">
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-border)]/40 text-[color:var(--color-muted)]">
          {icon}
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-[color:var(--color-muted)] max-w-md mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
