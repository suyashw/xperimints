export const ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export const INTEGRATION_TYPES = ['PEEC', 'GITHUB', 'VERCEL', 'LINEAR'] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const INTEGRATION_STATUSES = ['ACTIVE', 'NEEDS_REAUTH', 'DISABLED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/**
 * Experiment lifecycle. Transitions are enforced server-side by
 * ExperimentsService.transition(); see PLAN.md §5.3.
 */
export const EXPERIMENT_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'ANALYZING',
  'WIN',
  'LOSS',
  'INCONCLUSIVE',
  'CANCELLED',
  'ERRORED',
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<ExperimentStatus> = new Set([
  'WIN',
  'LOSS',
  'INCONCLUSIVE',
  'CANCELLED',
  'ERRORED',
]);

export const SNAPSHOT_KINDS = ['BASELINE', 'DAILY', 'FINAL'] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export const VERDICTS = ['WIN', 'LOSS', 'INCONCLUSIVE'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const EVENT_TYPES = [
  'CREATED',
  'POWER_ANALYZED',
  'BASELINE_CAPTURED',
  'LAUNCHED',
  'SNAPSHOTTED',
  'RESULT_COMPUTED',
  'LINEAR_TICKET_CREATED',
  'PR_COMMENTED',
  'PEEC_TOPIC_CREATED',
  'PEEC_TAG_CREATED',
  'ERROR',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Allowed state transitions. The state machine is intentionally narrow.
 * Cancellation can happen from any non-terminal state.
 */
export const ALLOWED_TRANSITIONS: ReadonlyMap<ExperimentStatus, ReadonlyArray<ExperimentStatus>> =
  new Map([
    ['DRAFT', ['SCHEDULED', 'CANCELLED', 'ERRORED']],
    ['SCHEDULED', ['RUNNING', 'CANCELLED', 'ERRORED']],
    ['RUNNING', ['RUNNING', 'ANALYZING', 'CANCELLED', 'ERRORED']],
    ['ANALYZING', ['WIN', 'LOSS', 'INCONCLUSIVE', 'ERRORED']],
    ['WIN', []],
    ['LOSS', []],
    ['INCONCLUSIVE', []],
    ['CANCELLED', []],
    ['ERRORED', []],
  ]);

export function canTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.includes(to) ?? false;
}
