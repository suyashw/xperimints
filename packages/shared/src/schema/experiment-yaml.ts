import { z } from 'zod';

/**
 * Known engine slugs from Peec MCP `list_models` (full set lives in the get_brand_report
 * filter enum). For the YAML-level convenience we accept the short brand names users
 * actually type — they get resolved to model_ids via list_models on parse.
 */
export const KNOWN_ENGINE_KEYS = [
  'perplexity',
  'chatgpt',
  'gemini',
  'claude',
  'grok',
  'copilot',
  'google_ai_overview',
  'deepseek',
  'llama',
] as const;
export type KnownEngineKey = (typeof KNOWN_ENGINE_KEYS)[number];

const promptRefSchema = z.object({
  prompt_id: z.string().min(1, 'prompt_id is required'),
});

const engineLiteralSchema = z.union([
  z.enum(KNOWN_ENGINE_KEYS),
  z
    .string()
    .min(1)
    .describe('A raw Peec model_id (advanced — escape hatch for engines not yet listed).'),
]);

/**
 * The on-disk experiment.yaml schema. Validated at PR open time and on manual create.
 * See PLAN.md §9 for the definitive shape.
 */
export const experimentYamlSchema = z
  .object({
    id: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
        message: 'id must be kebab-case (a-z, 0-9, hyphen)',
      }),
    name: z.string().min(3).max(160),
    hypothesis: z.string().min(10).max(1000),
    treatment_url: z.string().url(),
    treatment_prompts: z.array(promptRefSchema).min(1, 'at least one treatment prompt'),
    control_prompts: z.array(promptRefSchema).min(1, 'at least one control prompt'),
    engines: z.array(engineLiteralSchema).optional().default([]),
    min_lift_pp: z.number().positive().max(100, 'min_lift_pp is in percentage points (0-100)'),
    duration_days: z.union([z.literal('auto'), z.number().int().min(3).max(28)]).default('auto'),
    share: z.enum(['public', 'private']).default('private'),
    seed: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) => {
      const treatmentIds = new Set(v.treatment_prompts.map((p) => p.prompt_id));
      return v.control_prompts.every((p) => !treatmentIds.has(p.prompt_id));
    },
    { message: 'A prompt cannot be in both treatment and control sets', path: ['control_prompts'] },
  );

export type ExperimentYaml = z.infer<typeof experimentYamlSchema>;
