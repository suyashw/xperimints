/**
 * Format a 0-1 ratio (visibility, share-of-voice, citation-rate) as a percent
 * string. We chose a single helper to enforce a consistent display rule across
 * the dashboard, sparklines, and the public share page.
 *
 * Per packages/peec-ai-mcp.md: visibility, share_of_voice, retrieved_percentage
 * are 0-1 ratios; multiply by 100 for display. retrieval_rate and citation_rate
 * are averages and may exceed 1.0 — we still pass them through this helper but
 * cap nothing.
 */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

/**
 * Format a percentage-point delta with explicit sign. e.g. +5.2pp, -1.8pp.
 */
export function formatPpDelta(deltaRatio: number, fractionDigits = 1): string {
  if (!Number.isFinite(deltaRatio)) return '—';
  const v = deltaRatio * 100;
  const sign = v > 0 ? '+' : v < 0 ? '' : '±';
  return `${sign}${v.toFixed(fractionDigits)}pp`;
}

export function formatSentiment(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${Math.round(score)}/100`;
}

export function formatPosition(rank: number): string {
  if (!Number.isFinite(rank) || rank <= 0) return '—';
  return `#${rank.toFixed(1)}`;
}
