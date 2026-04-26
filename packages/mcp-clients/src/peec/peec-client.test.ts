import { describe, expect, it, beforeEach } from 'vitest';
import {
  decodeRows,
  FakePeecTransport,
  PeecClient,
  PEEC_TOOL_NAMES,
  PeecMcpError,
} from './index.js';

describe('PEEC_TOOL_NAMES', () => {
  it('lists exactly 27 tools (matches PLAN.md §5.4 coverage matrix)', () => {
    expect(PEEC_TOOL_NAMES).toHaveLength(27);
    expect(new Set(PEEC_TOOL_NAMES).size).toBe(27);
  });

  it('matches the on-disk MCP tool descriptors (no drift)', () => {
    // Hard-coded list: the canonical 27 tools the Peec MCP server exposes.
    const onDiskTools = [
      'create_brand',
      'create_prompt',
      'create_tag',
      'create_topic',
      'delete_brand',
      'delete_prompt',
      'delete_tag',
      'delete_topic',
      'get_actions',
      'get_brand_report',
      'get_chat',
      'get_domain_report',
      'get_url_content',
      'get_url_report',
      'list_brands',
      'list_chats',
      'list_models',
      'list_projects',
      'list_prompts',
      'list_search_queries',
      'list_shopping_queries',
      'list_tags',
      'list_topics',
      'update_brand',
      'update_prompt',
      'update_tag',
      'update_topic',
    ];
    expect([...PEEC_TOOL_NAMES].sort()).toEqual(onDiskTools.sort());
  });
});

describe('PeecClient (over FakePeecTransport)', () => {
  let transport: FakePeecTransport;
  let client: PeecClient;

  beforeEach(() => {
    transport = new FakePeecTransport();
    client = new PeecClient(transport);
  });

  it('round-trips list_projects', async () => {
    const r = await client.listProjects({});
    expect(r.rowCount).toBe(1);
    expect(decodeRows(r)[0]).toMatchObject({ id: 'demo_proj_1', name: 'Demo Project' });
    expect(transport.calls.at(0)?.name).toBe('list_projects');
  });

  it('forwards typed args for get_brand_report', async () => {
    await client.getBrandReport({
      project_id: 'demo_proj_1',
      start_date: '2026-04-01',
      end_date: '2026-04-15',
      dimensions: ['prompt_id', 'model_id'],
    });
    const call = transport.calls.at(-1);
    expect(call?.name).toBe('get_brand_report');
    expect(call?.args).toMatchObject({
      project_id: 'demo_proj_1',
      start_date: '2026-04-01',
      end_date: '2026-04-15',
      dimensions: ['prompt_id', 'model_id'],
    });
  });

  it('rejects bad input before hitting the transport', async () => {
    await expect(
      client.getBrandReport({
        project_id: 'demo_proj_1',
        start_date: '2026/04/01', // wrong format
        end_date: '2026-04-15',
      } as never),
    ).rejects.toBeInstanceOf(PeecMcpError);
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects bad output with a typed error', async () => {
    transport.on('list_projects', () => ({ totally: 'wrong' }));
    await expect(client.listProjects({})).rejects.toBeInstanceOf(PeecMcpError);
  });

  it('round-trips a write tool (create_topic)', async () => {
    const r = await client.createTopic({ project_id: 'demo_proj_1', name: 'experiment:abc' });
    expect(r).toEqual({ id: 'topic_new' });
    expect(transport.calls.at(-1)?.args).toMatchObject({
      project_id: 'demo_proj_1',
      name: 'experiment:abc',
    });
  });

  it('every PEEC_TOOL_NAMES entry resolves to a method on PeecClient', () => {
    const methodMap: Record<string, keyof PeecClient> = {
      list_projects: 'listProjects',
      list_models: 'listModels',
      list_brands: 'listBrands',
      list_topics: 'listTopics',
      list_tags: 'listTags',
      list_prompts: 'listPrompts',
      list_search_queries: 'listSearchQueries',
      list_shopping_queries: 'listShoppingQueries',
      list_chats: 'listChats',
      get_chat: 'getChat',
      get_brand_report: 'getBrandReport',
      get_domain_report: 'getDomainReport',
      get_url_report: 'getUrlReport',
      get_url_content: 'getUrlContent',
      get_actions: 'getActions',
      create_brand: 'createBrand',
      update_brand: 'updateBrand',
      delete_brand: 'deleteBrand',
      create_prompt: 'createPrompt',
      update_prompt: 'updatePrompt',
      delete_prompt: 'deletePrompt',
      create_topic: 'createTopic',
      update_topic: 'updateTopic',
      delete_topic: 'deleteTopic',
      create_tag: 'createTag',
      update_tag: 'updateTag',
      delete_tag: 'deleteTag',
    };
    for (const name of PEEC_TOOL_NAMES) {
      expect(typeof client[methodMap[name] as keyof PeecClient]).toBe('function');
    }
  });
});

describe('decodeRows', () => {
  it('zips columns and rows into objects', () => {
    const out = decodeRows<{ a: number; b: string }>({
      columns: ['a', 'b'],
      rows: [
        [1, 'x'],
        [2, 'y'],
      ],
      rowCount: 2,
    });
    expect(out).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
  });
});
