import type { PeecTransport } from './transport.js';

/**
 * In-memory transport for tests, the demo seed, and the public sandbox demo.
 * It returns canned responses for the read tools and tracks every write call
 * so tests can assert on the exact sequence the system invokes.
 *
 * This is the pivot that lets us build, test, and demo the entire pipeline
 * without ever needing live Peec credentials.
 */
export class FakePeecTransport implements PeecTransport {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  readonly responders = new Map<
    string,
    (args: Record<string, unknown>) => Promise<unknown> | unknown
  >();

  on(toolName: string, handler: (args: Record<string, unknown>) => Promise<unknown> | unknown) {
    this.responders.set(toolName, handler);
    return this;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    const handler = this.responders.get(name);
    if (handler) return handler(args);
    return defaultResponses[name] ?? { ok: true };
  }

  reset() {
    this.calls.length = 0;
    this.responders.clear();
  }
}

const defaultColumnar = {
  columns: ['id', 'name'],
  rows: [['demo_1', 'Demo']],
  rowCount: 1,
};

/**
 * Sensible defaults so a freshly-instantiated FakePeecTransport already
 * answers every tool with something type-valid.
 */
const defaultResponses: Record<string, unknown> = {
  list_projects: {
    columns: ['id', 'name', 'status'],
    rows: [['demo_proj_1', 'Demo Project', 'CUSTOMER']],
    rowCount: 1,
  },
  list_models: {
    columns: ['id', 'name'],
    rows: [
      ['perplexity-scraper', 'Perplexity'],
      ['chatgpt-scraper', 'ChatGPT'],
      ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ],
    rowCount: 3,
  },
  list_brands: {
    columns: ['id', 'name', 'is_own'],
    rows: [
      ['brand_own', 'Acme', true],
      ['brand_intercom', 'Intercom', false],
    ],
    rowCount: 2,
  },
  list_topics: defaultColumnar,
  list_tags: defaultColumnar,
  list_prompts: {
    columns: ['id', 'text'],
    rows: [
      ['prm_a', 'best CRM for startups'],
      ['prm_b', 'top CRM for early-stage SaaS'],
      ['prm_c', 'best helpdesk for SMB'],
      ['prm_d', 'helpdesk software comparison'],
    ],
    rowCount: 4,
  },
  list_search_queries: defaultColumnar,
  list_shopping_queries: defaultColumnar,
  list_chats: {
    columns: ['chat_id', 'model_id'],
    rows: [['chat_1', 'perplexity-scraper']],
    rowCount: 1,
  },
  get_chat: {
    chat_id: 'chat_1',
    model_id: 'perplexity-scraper',
    prompt_text: 'best CRM for startups',
    response: 'For startups, the leading CRMs are…',
    citations: [],
  },
  get_brand_report: {
    columns: ['brand_id', 'brand_name', 'visibility', 'share_of_voice', 'sentiment', 'position'],
    rows: [['brand_own', 'Acme', 0.42, 0.18, 76, 2.1]],
    rowCount: 1,
  },
  get_domain_report: {
    columns: ['domain', 'citation_rate', 'retrieval_rate'],
    rows: [['acme.com', 0.31, 0.42]],
    rowCount: 1,
  },
  get_url_report: {
    columns: ['url', 'citation_rate', 'retrieval_rate'],
    rows: [['https://acme.com/best-crm-for-startups', 0.28, 0.35]],
    rowCount: 1,
  },
  get_url_content: {
    url: 'https://acme.com/best-crm-for-startups',
    title: 'Best CRM for startups in 2026',
    domain: 'acme.com',
    classification: 'OWNED',
    url_classification: 'LISTICLE',
    content: '# Best CRM for startups\n\n…\n',
    content_length: 5000,
    truncated: false,
    content_updated_at: new Date().toISOString(),
  },
  get_actions: {
    scope: 'overview',
    actions: [
      { title: 'Add author bios', priority: 'high' },
      { title: 'Cite primary research', priority: 'medium' },
    ],
  },
  create_brand: { id: 'brand_new' },
  update_brand: { ok: true },
  delete_brand: { deleted: true },
  create_prompt: { id: 'prm_new' },
  update_prompt: { ok: true },
  delete_prompt: { deleted: true },
  create_topic: { id: 'topic_new' },
  update_topic: { ok: true },
  delete_topic: { deleted: true },
  create_tag: { id: 'tag_new' },
  update_tag: { ok: true },
  delete_tag: { deleted: true },
};
