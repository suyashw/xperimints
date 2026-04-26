import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Common schemas (matching what Peec MCP actually returns — see /mcps/user-peec-ai/tools)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Peec returns "columnar JSON" for most read endpoints: { columns, rows, rowCount, total? }.
 * Each row is an array of values matching `columns` order. We model it generically and
 * give callers a `decodeRows()` helper.
 */
export const columnarResponseSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  rowCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
});
export type ColumnarResponse = z.infer<typeof columnarResponseSchema>;

export function decodeRows<T extends Record<string, unknown>>(resp: ColumnarResponse): T[] {
  return resp.rows.map((row) => {
    const out: Record<string, unknown> = {};
    resp.columns.forEach((col, i) => {
      out[col] = row[i];
    });
    return out as T;
  });
}

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const filterSchema = z.object({
  field: z.string(),
  operator: z.enum(['in', 'not_in']),
  values: z.array(z.string()).min(1),
});

export const dimensionSchema = z.enum([
  'prompt_id',
  'model_id',
  'model_channel_id',
  'tag_id',
  'topic_id',
  'date',
  'country_code',
  'chat_id',
]);

export const projectIdSchema = z.string().min(1);

// ──────────────────────────────────────────────────────────────────────────────
// Read tools — input schemas
// ──────────────────────────────────────────────────────────────────────────────

export const listProjectsInput = z
  .object({ include_inactive: z.boolean().optional().default(false) })
  .strict();

export const listModelsInput = z
  .object({ project_id: projectIdSchema })
  .strict();

export const listBrandsInput = z
  .object({
    project_id: projectIdSchema,
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const listTopicsInput = listBrandsInput;
export const listTagsInput = listBrandsInput;
export const listPromptsInput = z
  .object({
    project_id: projectIdSchema,
    topic_id: z.string().optional(),
    tag_id: z.string().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const listSearchQueriesInput = z
  .object({
    project_id: projectIdSchema,
    start_date: dateString,
    end_date: dateString,
    limit: z.number().int().min(1).max(10000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const listShoppingQueriesInput = listSearchQueriesInput;

export const listChatsInput = z
  .object({
    project_id: projectIdSchema,
    start_date: dateString,
    end_date: dateString,
    filters: z.array(filterSchema).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const getChatInput = z
  .object({
    project_id: projectIdSchema,
    chat_id: z.string().min(1),
  })
  .strict();

export const getBrandReportInput = z
  .object({
    project_id: projectIdSchema,
    start_date: dateString,
    end_date: dateString,
    dimensions: z.array(dimensionSchema).optional(),
    filters: z.array(filterSchema).optional(),
    limit: z.number().int().min(1).max(10000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const getDomainReportInput = getBrandReportInput;
export const getUrlReportInput = getBrandReportInput;

export const getUrlContentInput = z
  .object({
    project_id: projectIdSchema,
    url: z.string().url(),
    max_length: z.number().int().min(1).max(20_000_000).optional(),
  })
  .strict();

export const getActionsInput = z
  .object({
    project_id: projectIdSchema,
    scope: z
      .enum(['overview', 'owned', 'editorial', 'reference', 'ugc'])
      .optional()
      .default('overview'),
  })
  .strict();

// ──────────────────────────────────────────────────────────────────────────────
// Write tools — input schemas
// ──────────────────────────────────────────────────────────────────────────────

export const createBrandInput = z
  .object({
    project_id: projectIdSchema,
    name: z.string().min(1).max(120),
    domain: z.string().optional(),
    is_own: z.boolean().optional(),
  })
  .strict();

export const updateBrandInput = z
  .object({
    project_id: projectIdSchema,
    brand_id: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
    domain: z.string().optional(),
    is_own: z.boolean().optional(),
  })
  .strict();

export const deleteBrandInput = z
  .object({ project_id: projectIdSchema, brand_id: z.string().min(1) })
  .strict();

export const createPromptInput = z
  .object({
    project_id: projectIdSchema,
    text: z.string().min(1).max(2000),
    topic_id: z.string().optional(),
    tag_ids: z.array(z.string()).optional(),
    country_code: z.string().length(2).optional(),
  })
  .strict();

export const updatePromptInput = z
  .object({
    project_id: projectIdSchema,
    prompt_id: z.string().min(1),
    text: z.string().min(1).max(2000).optional(),
    topic_id: z.string().optional(),
    tag_ids: z.array(z.string()).optional(),
  })
  .strict();

export const deletePromptInput = z
  .object({ project_id: projectIdSchema, prompt_id: z.string().min(1) })
  .strict();

export const createTopicInput = z
  .object({
    project_id: projectIdSchema,
    name: z.string().min(1).max(64),
    country_code: z.string().length(2).optional(),
  })
  .strict();

export const updateTopicInput = z
  .object({
    project_id: projectIdSchema,
    topic_id: z.string().min(1),
    name: z.string().min(1).max(64).optional(),
  })
  .strict();

export const deleteTopicInput = z
  .object({ project_id: projectIdSchema, topic_id: z.string().min(1) })
  .strict();

export const createTagInput = z
  .object({
    project_id: projectIdSchema,
    name: z.string().min(1).max(64),
  })
  .strict();

export const updateTagInput = z
  .object({
    project_id: projectIdSchema,
    tag_id: z.string().min(1),
    name: z.string().min(1).max(64).optional(),
  })
  .strict();

export const deleteTagInput = z
  .object({ project_id: projectIdSchema, tag_id: z.string().min(1) })
  .strict();

// ──────────────────────────────────────────────────────────────────────────────
// Output schemas — kept loose where Peec returns ad-hoc shapes; tight where
// we depend on the exact field
// ──────────────────────────────────────────────────────────────────────────────

export const idResponseSchema = z.union([
  z.object({ id: z.string() }),
  z.object({ topic_id: z.string() }),
  z.object({ tag_id: z.string() }),
  z.object({ brand_id: z.string() }),
  z.object({ prompt_id: z.string() }),
]);

export const okResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ success: z.literal(true) }),
  z.object({ deleted: z.literal(true) }),
]);

export const urlContentResponseSchema = z.object({
  url: z.string(),
  title: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  channel_title: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  url_classification: z.string().nullable().optional(),
  content: z.string().nullable(),
  content_length: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  content_updated_at: z.string().nullable().optional(),
});
export type UrlContentResponse = z.infer<typeof urlContentResponseSchema>;

export const chatDetailSchema = z.object({
  chat_id: z.string(),
  model_id: z.string(),
  prompt_id: z.string().optional(),
  prompt_text: z.string().optional(),
  response: z.string().optional(),
  citations: z
    .array(
      z.object({
        url: z.string(),
        domain: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .optional(),
  created_at: z.string().optional(),
});
export type ChatDetail = z.infer<typeof chatDetailSchema>;

export const actionsResponseSchema = z.object({
  scope: z.string().optional(),
  actions: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
        url: z.string().optional(),
      }),
    )
    .default([]),
});
