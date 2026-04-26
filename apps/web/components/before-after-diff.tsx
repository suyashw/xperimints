import { EmptyState } from './empty-state';

/**
 * BeforeAfterDiff — side-by-side render of the two `get_url_content` snapshots
 * we take of the treatment URL: one at baseline (pre-launch) and one at
 * launch + 1 day. Highlights lines that exist in only one panel.
 *
 * No external diff library — we use a tiny line-set difference implementation
 * that's good enough for "show what changed" intuition.
 */
export function BeforeAfterDiff({
  before,
  after,
}: {
  before: string | null;
  after: string | null;
}) {
  if (!before && !after) {
    return (
      <EmptyState
        title="URL snapshots not captured yet"
        description="get_url_content runs at baseline and launch + 1 day. The before/after diff appears once both snapshots exist."
      />
    );
  }
  if (!before) {
    return (
      <div className="rounded-lg border border-[color:var(--color-border)] p-4">
        <p className="text-sm text-[color:var(--color-muted)] mb-2">
          Only post-launch snapshot is available; the baseline was missed.
        </p>
        <Pane label="After" content={after} className="bg-emerald-50/40" />
      </div>
    );
  }
  if (!after) {
    return (
      <div className="rounded-lg border border-[color:var(--color-border)] p-4">
        <p className="text-sm text-[color:var(--color-muted)] mb-2">
          Post-launch snapshot pending — checks back tomorrow at 06:00 UTC.
        </p>
        <Pane label="Before" content={before} className="bg-zinc-50/60" />
      </div>
    );
  }

  const beforeLines = normalize(before);
  const afterLines = normalize(after);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const added = afterLines.filter((l) => !beforeSet.has(l)).length;
  const removed = beforeLines.filter((l) => !afterSet.has(l)).length;
  const charsBefore = before.length;
  const charsAfter = after.length;

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-3 text-xs text-[color:var(--color-muted)]">
        <span>
          <span className="text-emerald-700 font-medium">+{added}</span> lines added
        </span>
        <span>
          <span className="text-red-700 font-medium">−{removed}</span> lines removed
        </span>
        <span>·</span>
        <span>
          {charsBefore.toLocaleString()} → {charsAfter.toLocaleString()} chars (
          {charsAfter - charsBefore >= 0 ? '+' : ''}
          {(charsAfter - charsBefore).toLocaleString()})
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wider">
          Source: <code>get_url_content</code>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Pane
          label="Before (baseline)"
          content={before}
          highlight={(line) => !afterSet.has(line)}
          highlightClass="bg-red-100/60"
          className="bg-zinc-50/40"
        />
        <Pane
          label="After (launch + 1d)"
          content={after}
          highlight={(line) => !beforeSet.has(line)}
          highlightClass="bg-emerald-100/60"
          className="bg-emerald-50/30"
        />
      </div>
    </div>
  );
}

function Pane({
  label,
  content,
  className,
  highlight,
  highlightClass,
}: {
  label: string;
  content: string | null;
  className?: string;
  highlight?: (line: string) => boolean;
  highlightClass?: string;
}) {
  if (!content) return null;
  const lines = content.split('\n');
  return (
    <div className={`rounded-md border border-[color:var(--color-border)] ${className ?? ''}`}>
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] border-b border-[color:var(--color-border)]">
        {label}
      </div>
      <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words p-3 max-h-96 overflow-auto">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          const isChanged = trimmed.length > 0 && highlight ? highlight(trimmed) : false;
          return (
            <span
              key={i}
              className={`block ${isChanged ? `${highlightClass ?? ''} -mx-3 px-3` : ''}`}
            >
              {line || '\u00A0'}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function normalize(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
