import { z } from 'zod';
import {
  EVENT_TYPES,
  EXPERIMENT_STATUSES,
  INTEGRATION_STATUSES,
  INTEGRATION_TYPES,
  SNAPSHOT_KINDS,
  VERDICTS,
} from '../enums.js';

export const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES);
export const verdictSchema = z.enum(VERDICTS);
export const snapshotKindSchema = z.enum(SNAPSHOT_KINDS);
export const eventTypeSchema = z.enum(EVENT_TYPES);
export const integrationTypeSchema = z.enum(INTEGRATION_TYPES);
export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);

export const liftByEngineSchema = z.record(
  z.string(),
  z.object({
    lift_pp: z.number(),
    ci_low: z.number(),
    ci_high: z.number(),
    p_value: z.number().min(0).max(1),
    p_value_corrected: z.number().min(0).max(1).optional(),
    samples_pre: z.number().int().nonnegative(),
    samples_post: z.number().int().nonnegative(),
  }),
);
export type LiftByEngine = z.infer<typeof liftByEngineSchema>;

export const competitorMovementSchema = z.record(
  z.string(),
  z.object({
    brand_name: z.string(),
    sov_delta: z.number(),
    visibility_delta: z.number(),
    citation_delta: z.number().optional(),
  }),
);
export type CompetitorMovement = z.infer<typeof competitorMovementSchema>;

export const evidenceChatSchema = z.object({
  chat_id: z.string(),
  model_id: z.string(),
  prompt_id: z.string().optional(),
  summary: z.string(),
  link: z.string().url().optional(),
});
export const evidenceChatsSchema = z.array(evidenceChatSchema).max(20);
export type EvidenceChat = z.infer<typeof evidenceChatSchema>;

/**
 * Per-cell metric — exactly what we persist into ExperimentSnapshot.brandMetrics
 * for each (promptId, engineId) pair.
 */
export const brandCellSchema = z.object({
  visibility: z.number().min(0).max(1),
  share_of_voice: z.number().min(0).max(1).optional(),
  citation_rate: z.number().nonnegative().optional(),
  sentiment: z.number().min(0).max(100).optional(),
  position: z.number().positive().optional(),
  mention_count: z.number().int().nonnegative().optional(),
});
export type BrandCell = z.infer<typeof brandCellSchema>;

export const brandMetricsSchema = z.record(
  z.string(), // promptId
  z.record(z.string(), brandCellSchema), // engineId → cell
);
export type BrandMetrics = z.infer<typeof brandMetricsSchema>;
