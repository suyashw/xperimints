'use client';

import { EngineLiftBarChart, type EngineLiftRow } from './engine-lift-bar-chart';
import { EvidenceDrawer, useEvidenceDrawerState, type EvidenceChat } from './evidence-drawer';

/**
 * Composed: bar chart + evidence drawer. Each engine gets a "Show evidence"
 * button below the chart (since clickable chart bars are unreliable across
 * Recharts versions). PLAN.md §6.2 line: "EvidenceDrawer — opens chats from
 * list_chats + get_chat for a given engine bar."
 */
export function EngineLiftWithEvidence({
  rows,
  evidenceByEngine,
}: {
  rows: EngineLiftRow[];
  evidenceByEngine: Record<string, EvidenceChat[]>;
}) {
  const drawer = useEvidenceDrawerState();
  return (
    <div className="space-y-3">
      <EngineLiftBarChart rows={rows} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[color:var(--color-muted)]">Show evidence for</span>
        {rows.map((r) => (
          <button
            key={r.engine}
            type="button"
            onClick={() => drawer.show(r.engine)}
            className="rounded-md border border-[color:var(--color-border)] px-2 py-0.5 hover:border-[color:var(--color-accent)]"
          >
            <code>{r.engine}</code>
          </button>
        ))}
      </div>
      <EvidenceDrawer
        open={drawer.open}
        onClose={drawer.close}
        engine={drawer.engine}
        chats={drawer.engine ? (evidenceByEngine[drawer.engine] ?? []) : []}
      />
    </div>
  );
}
