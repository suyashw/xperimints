import { makeTool, type PeecTransport } from './transport.js';
import {
  actionsResponseSchema,
  chatDetailSchema,
  columnarResponseSchema,
  createBrandInput,
  createPromptInput,
  createTagInput,
  createTopicInput,
  deleteBrandInput,
  deletePromptInput,
  deleteTagInput,
  deleteTopicInput,
  getActionsInput,
  getBrandReportInput,
  getChatInput,
  getDomainReportInput,
  getUrlContentInput,
  getUrlReportInput,
  idResponseSchema,
  listBrandsInput,
  listChatsInput,
  listModelsInput,
  listProjectsInput,
  listPromptsInput,
  listSearchQueriesInput,
  listShoppingQueriesInput,
  listTagsInput,
  listTopicsInput,
  okResponseSchema,
  updateBrandInput,
  updatePromptInput,
  updateTagInput,
  updateTopicInput,
  urlContentResponseSchema,
} from './schemas.js';

/**
 * The complete typed surface for all 27 Peec MCP tools (PLAN.md §5.4).
 *
 * Each method:
 *   - validates input with Zod
 *   - calls the supplied transport (HTTP+SSE, fake, or anything else)
 *   - validates the response with Zod
 *   - returns a typed value
 */
export class PeecClient {
  // Reads (15)
  readonly listProjects: ReturnType<typeof makeTool<typeof listProjectsInput, typeof columnarResponseSchema>>;
  readonly listModels: ReturnType<typeof makeTool<typeof listModelsInput, typeof columnarResponseSchema>>;
  readonly listBrands: ReturnType<typeof makeTool<typeof listBrandsInput, typeof columnarResponseSchema>>;
  readonly listTopics: ReturnType<typeof makeTool<typeof listTopicsInput, typeof columnarResponseSchema>>;
  readonly listTags: ReturnType<typeof makeTool<typeof listTagsInput, typeof columnarResponseSchema>>;
  readonly listPrompts: ReturnType<typeof makeTool<typeof listPromptsInput, typeof columnarResponseSchema>>;
  readonly listSearchQueries: ReturnType<typeof makeTool<typeof listSearchQueriesInput, typeof columnarResponseSchema>>;
  readonly listShoppingQueries: ReturnType<typeof makeTool<typeof listShoppingQueriesInput, typeof columnarResponseSchema>>;
  readonly listChats: ReturnType<typeof makeTool<typeof listChatsInput, typeof columnarResponseSchema>>;
  readonly getChat: ReturnType<typeof makeTool<typeof getChatInput, typeof chatDetailSchema>>;
  readonly getBrandReport: ReturnType<typeof makeTool<typeof getBrandReportInput, typeof columnarResponseSchema>>;
  readonly getDomainReport: ReturnType<typeof makeTool<typeof getDomainReportInput, typeof columnarResponseSchema>>;
  readonly getUrlReport: ReturnType<typeof makeTool<typeof getUrlReportInput, typeof columnarResponseSchema>>;
  readonly getUrlContent: ReturnType<typeof makeTool<typeof getUrlContentInput, typeof urlContentResponseSchema>>;
  readonly getActions: ReturnType<typeof makeTool<typeof getActionsInput, typeof actionsResponseSchema>>;

  // Writes (12)
  readonly createBrand: ReturnType<typeof makeTool<typeof createBrandInput, typeof idResponseSchema>>;
  readonly updateBrand: ReturnType<typeof makeTool<typeof updateBrandInput, typeof okResponseSchema>>;
  readonly deleteBrand: ReturnType<typeof makeTool<typeof deleteBrandInput, typeof okResponseSchema>>;
  readonly createPrompt: ReturnType<typeof makeTool<typeof createPromptInput, typeof idResponseSchema>>;
  readonly updatePrompt: ReturnType<typeof makeTool<typeof updatePromptInput, typeof okResponseSchema>>;
  readonly deletePrompt: ReturnType<typeof makeTool<typeof deletePromptInput, typeof okResponseSchema>>;
  readonly createTopic: ReturnType<typeof makeTool<typeof createTopicInput, typeof idResponseSchema>>;
  readonly updateTopic: ReturnType<typeof makeTool<typeof updateTopicInput, typeof okResponseSchema>>;
  readonly deleteTopic: ReturnType<typeof makeTool<typeof deleteTopicInput, typeof okResponseSchema>>;
  readonly createTag: ReturnType<typeof makeTool<typeof createTagInput, typeof idResponseSchema>>;
  readonly updateTag: ReturnType<typeof makeTool<typeof updateTagInput, typeof okResponseSchema>>;
  readonly deleteTag: ReturnType<typeof makeTool<typeof deleteTagInput, typeof okResponseSchema>>;

  constructor(readonly transport: PeecTransport) {
    this.listProjects = makeTool(transport, {
      name: 'list_projects',
      inputSchema: listProjectsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listModels = makeTool(transport, {
      name: 'list_models',
      inputSchema: listModelsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listBrands = makeTool(transport, {
      name: 'list_brands',
      inputSchema: listBrandsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listTopics = makeTool(transport, {
      name: 'list_topics',
      inputSchema: listTopicsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listTags = makeTool(transport, {
      name: 'list_tags',
      inputSchema: listTagsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listPrompts = makeTool(transport, {
      name: 'list_prompts',
      inputSchema: listPromptsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listSearchQueries = makeTool(transport, {
      name: 'list_search_queries',
      inputSchema: listSearchQueriesInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listShoppingQueries = makeTool(transport, {
      name: 'list_shopping_queries',
      inputSchema: listShoppingQueriesInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.listChats = makeTool(transport, {
      name: 'list_chats',
      inputSchema: listChatsInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.getChat = makeTool(transport, {
      name: 'get_chat',
      inputSchema: getChatInput,
      outputSchema: chatDetailSchema,
      idempotent: true,
    });
    this.getBrandReport = makeTool(transport, {
      name: 'get_brand_report',
      inputSchema: getBrandReportInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.getDomainReport = makeTool(transport, {
      name: 'get_domain_report',
      inputSchema: getDomainReportInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.getUrlReport = makeTool(transport, {
      name: 'get_url_report',
      inputSchema: getUrlReportInput,
      outputSchema: columnarResponseSchema,
      idempotent: true,
    });
    this.getUrlContent = makeTool(transport, {
      name: 'get_url_content',
      inputSchema: getUrlContentInput,
      outputSchema: urlContentResponseSchema,
      idempotent: true,
    });
    this.getActions = makeTool(transport, {
      name: 'get_actions',
      inputSchema: getActionsInput,
      outputSchema: actionsResponseSchema,
      idempotent: true,
    });

    this.createBrand = makeTool(transport, {
      name: 'create_brand',
      inputSchema: createBrandInput,
      outputSchema: idResponseSchema,
      idempotent: false,
    });
    this.updateBrand = makeTool(transport, {
      name: 'update_brand',
      inputSchema: updateBrandInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.deleteBrand = makeTool(transport, {
      name: 'delete_brand',
      inputSchema: deleteBrandInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.createPrompt = makeTool(transport, {
      name: 'create_prompt',
      inputSchema: createPromptInput,
      outputSchema: idResponseSchema,
      idempotent: false,
    });
    this.updatePrompt = makeTool(transport, {
      name: 'update_prompt',
      inputSchema: updatePromptInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.deletePrompt = makeTool(transport, {
      name: 'delete_prompt',
      inputSchema: deletePromptInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.createTopic = makeTool(transport, {
      name: 'create_topic',
      inputSchema: createTopicInput,
      outputSchema: idResponseSchema,
      idempotent: false,
    });
    this.updateTopic = makeTool(transport, {
      name: 'update_topic',
      inputSchema: updateTopicInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.deleteTopic = makeTool(transport, {
      name: 'delete_topic',
      inputSchema: deleteTopicInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.createTag = makeTool(transport, {
      name: 'create_tag',
      inputSchema: createTagInput,
      outputSchema: idResponseSchema,
      idempotent: false,
    });
    this.updateTag = makeTool(transport, {
      name: 'update_tag',
      inputSchema: updateTagInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
    this.deleteTag = makeTool(transport, {
      name: 'delete_tag',
      inputSchema: deleteTagInput,
      outputSchema: okResponseSchema,
      idempotent: false,
    });
  }
}

/**
 * Sentinel — every tool listed in PLAN.md §5.4. Used by tests to assert the
 * client really covers all 27.
 */
export const PEEC_TOOL_NAMES = [
  'list_projects',
  'list_models',
  'list_brands',
  'list_topics',
  'list_tags',
  'list_prompts',
  'list_search_queries',
  'list_shopping_queries',
  'list_chats',
  'get_chat',
  'get_brand_report',
  'get_domain_report',
  'get_url_report',
  'get_url_content',
  'get_actions',
  'create_brand',
  'update_brand',
  'delete_brand',
  'create_prompt',
  'update_prompt',
  'delete_prompt',
  'create_topic',
  'update_topic',
  'delete_topic',
  'create_tag',
  'update_tag',
  'delete_tag',
] as const;
export type PeecToolName = (typeof PEEC_TOOL_NAMES)[number];
