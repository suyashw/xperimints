import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@peec-lab/database';
import { decodeRows } from '@peec-lab/mcp-clients';
import { PRISMA } from '../../prisma/prisma.module.js';
import { PeecMcpService } from './peec-mcp.service.js';
import { SnapshotsService } from '../snapshots/snapshots.service.js';
import { generateProjectDescription } from './project-description.js';

interface SyncResult {
  mode: 'live' | 'disconnected';
  organization: { id: string; slug: string };
  peecProject: {
    internalId: string;
    peecProjectId: string;
    name: string;
    promptCount: number;
    brandCount: number;
    modelCount: number;
    topicCount: number;
    tagCount: number;
  } | null;
  snapshotsCaptured: number;
  experimentsRefreshed: Array<{ id: string; name: string; ok: boolean; error?: string }>;
  durationMs: number;
}

/**
 * Pulls live data from Peec MCP into our local Postgres cache:
 *   1. list_projects → pick the project (preferred id from arg, else the first one)
 *   2. list_models / list_prompts / list_brands / list_topics / list_tags → cache it
 *   3. for every RUNNING experiment in this org, capture a fresh snapshot
 *
 * Idempotent. Safe to run repeatedly (the daily cron does the same thing).
 *
 * If PeecMcpService is in `disconnected` mode (no PEEC_MCP_TOKEN), the sync
 * is a no-op and the UI tells the user how to connect.
 *
 * Sync only runs on explicit user action (Refresh-from-Peec button → POST
 * /v1/peec/sync) or the daily cron. There is no auto-sync on app bootstrap
 * or page render — by design, every Peec call should be attributable to a
 * deliberate trigger so quota burn and outage exposure stay predictable.
 */
@Injectable()
export class PeecSyncService {
  private readonly logger = new Logger(PeecSyncService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly peec: PeecMcpService,
    private readonly snapshots: SnapshotsService,
  ) {}

  async syncForOrg(
    organizationId: string,
    opts: { preferredPeecProjectId?: string } = {},
  ): Promise<SyncResult> {
    const start = Date.now();
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const peecClient = await this.peec.getClient(organizationId);
    if (!peecClient) {
      return {
        mode: 'disconnected',
        organization: { id: org.id, slug: org.slug },
        peecProject: null,
        snapshotsCaptured: 0,
        experimentsRefreshed: [],
        durationMs: Date.now() - start,
      };
    }

    // 1. Resolve the project.
    const projectsResp = await peecClient.listProjects({ include_inactive: false });
    const projectRows = decodeRows<{ id: string; name: string; status?: string }>(projectsResp);
    if (projectRows.length === 0) {
      this.logger.warn('list_projects returned 0 projects — sync is a no-op.');
      return {
        mode: 'live',
        organization: { id: org.id, slug: org.slug },
        peecProject: null,
        snapshotsCaptured: 0,
        experimentsRefreshed: [],
        durationMs: Date.now() - start,
      };
    }
    const chosen =
      projectRows.find((p) => p.id === opts.preferredPeecProjectId) ?? projectRows[0]!;
    this.logger.log(`Sync: chose project ${chosen.id} (${chosen.name})`);

    // 2. Pull caches in parallel (these are independent reads).
    const [models, prompts, brands, topics, tags] = await Promise.all([
      peecClient.listModels({ project_id: chosen.id }).catch(this.tolerate('list_models')),
      peecClient
        .listPrompts({ project_id: chosen.id, limit: 200 })
        .catch(this.tolerate('list_prompts')),
      peecClient
        .listBrands({ project_id: chosen.id, limit: 200 })
        .catch(this.tolerate('list_brands')),
      peecClient
        .listTopics({ project_id: chosen.id, limit: 200 })
        .catch(this.tolerate('list_topics')),
      peecClient
        .listTags({ project_id: chosen.id, limit: 200 })
        .catch(this.tolerate('list_tags')),
    ]);

    const modelIds = decodeRows<{ id: string }>(models)
      .map((r) => r.id)
      .filter(Boolean);
    const promptCount = prompts.rowCount;
    const brandCount = brands.rowCount;

    // 2b. Pull analytics reports (project-level, last 14 days) used by the
    //     dashboard cards that inform experiment design. These are independent
    //     of any single experiment — they describe the project's overall
    //     visibility surface so users can pick treatment/control prompts and
    //     engines based on real signal. Each call is tolerated independently
    //     so a single failure doesn't poison the whole sync.
    const today = new Date();
    const startDate = isoDate(addDays(today, -14));
    const endDate = isoDate(today);

    const [
      brandTotals,
      promptVisibility,
      engineVisibility,
      topUrls,
      actions,
      searchQueries,
    ] = await Promise.all([
      peecClient
        .getBrandReport({ project_id: chosen.id, start_date: startDate, end_date: endDate })
        .catch(this.tolerate('get_brand_report (totals)')),
      peecClient
        .getBrandReport({
          project_id: chosen.id,
          start_date: startDate,
          end_date: endDate,
          dimensions: ['prompt_id'],
          limit: 500,
        })
        .catch(this.tolerate('get_brand_report (prompt)')),
      peecClient
        .getBrandReport({
          project_id: chosen.id,
          start_date: startDate,
          end_date: endDate,
          dimensions: ['model_id'],
        })
        .catch(this.tolerate('get_brand_report (model)')),
      peecClient
        .getUrlReport({
          project_id: chosen.id,
          start_date: startDate,
          end_date: endDate,
          limit: 50,
        })
        .catch(this.tolerate('get_url_report')),
      // Peec's AI-recommended next actions for the project. Drives the
      // dashboard's "Suggested actions" card so users have a one-click
      // bridge from "what's wrong" → "experiment to fix it". Tolerated
      // independently — older Peec workspaces may not expose this scope.
      peecClient
        .getActions({ project_id: chosen.id, scope: 'overview' })
        .catch((err: Error) => {
          this.logger.warn(`get_actions failed during sync: ${err.message}`);
          return { scope: 'overview', actions: [] };
        }),
      // list_search_queries → top fan-out queries asked of AI engines for
      // this project's window. Surfaces a "Demand signal" card on the
      // dashboard so users see what real users are searching for, not
      // just what they already track in Peec. Tolerated independently:
      // not all Peec workspaces expose this endpoint.
      peecClient
        .listSearchQueries({
          project_id: chosen.id,
          start_date: startDate,
          end_date: endDate,
          limit: 100,
        })
        .catch(this.tolerate('list_search_queries')),
    ]);

    // 2c. Generate the human-readable project description that the
    //     dashboard header renders in place of the raw `peec_project_id`.
    //     Tolerated independently — if it throws (or returns ''), we just
    //     persist null and the dashboard falls back to a generic copy.
    let description: string | null = null;
    try {
      const text = await generateProjectDescription({
        projectName: chosen.name,
        brandRows: brands,
        topicRows: topics,
        modelIds,
        promptRows: prompts,
      });
      description = text.length > 0 ? text : null;
    } catch (err) {
      this.logger.warn(`generateProjectDescription failed: ${(err as Error).message}`);
    }

    // 3. Upsert PeecProject cache.
    const cachedFields = {
      name: chosen.name,
      cachedPromptCount: promptCount,
      cachedBrandCount: brandCount,
      cachedModels: modelIds,
      cachedTopics: stripColumnar(topics),
      cachedTags: stripColumnar(tags),
      cachedBrandTotals: stripColumnar(brandTotals),
      cachedPromptVisibility: stripColumnar(promptVisibility),
      cachedEngineVisibility: stripColumnar(engineVisibility),
      cachedTopUrls: stripColumnar(topUrls),
      cachedPrompts: stripColumnar(prompts),
      // get_actions returns { scope, actions: [...] } — JSON-roundtrip to
      // strip Date-likes and satisfy Prisma's InputJsonValue constraint.
      cachedActions: JSON.parse(JSON.stringify(actions.actions ?? [])) as object,
      cachedSearchQueries: stripColumnar(searchQueries),
      cachedDescription: description,
      lastSyncedAt: new Date(),
      // Sync succeeded — wipe any prior error so the dashboard pill flips
      // back to "Live" on the next render.
      lastSyncError: null,
      lastSyncErrorAt: null,
    };
    const project = await this.prisma.peecProject.upsert({
      where: {
        organizationId_peecProjectId: {
          organizationId: org.id,
          peecProjectId: chosen.id,
        },
      },
      create: {
        organizationId: org.id,
        peecProjectId: chosen.id,
        ...cachedFields,
      },
      update: cachedFields,
    });

    // 4. Refresh every RUNNING experiment that points at this project.
    const due = await this.prisma.experiment.findMany({
      where: { organizationId: org.id, peecProjectId: project.id, status: 'RUNNING' },
      select: { id: true, name: true },
    });
    const refreshed: SyncResult['experimentsRefreshed'] = [];
    let snapshotsCaptured = 0;
    for (const exp of due) {
      try {
        await this.snapshots.captureFor(exp.id, 'DAILY');
        await this.prisma.experimentEvent.create({
          data: { experimentId: exp.id, type: 'SNAPSHOTTED', payload: { source: 'sync' } },
        });
        refreshed.push({ id: exp.id, name: exp.name, ok: true });
        snapshotsCaptured += 1;
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.warn(`Snapshot for ${exp.id} failed: ${msg}`);
        refreshed.push({ id: exp.id, name: exp.name, ok: false, error: msg });
      }
    }

    return {
      mode: 'live',
      organization: { id: org.id, slug: org.slug },
      peecProject: {
        internalId: project.id,
        peecProjectId: chosen.id,
        name: chosen.name,
        promptCount,
        brandCount,
        modelCount: modelIds.length,
        topicCount: topics.rowCount,
        tagCount: tags.rowCount,
      },
      snapshotsCaptured,
      experimentsRefreshed: refreshed,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Persist the most recent sync failure so the dashboard's status pill can
   * flip to "Sync failed" without us threading the error through transient
   * API responses. We only update PeecProject rows that already exist —
   * nothing else can write `lastSyncError` from outside this service, so on
   * the first dashboard render after a successful sync the field is
   * authoritative.
   *
   * If no PeecProject row exists yet (first-ever sync attempt failed
   * because list_projects threw before we could pick one), there's nothing
   * to update and the dashboard simply shows the "Disconnected"/no-project
   * state the cached row would have shown anyway.
   */
  async recordSyncError(organizationId: string, message: string): Promise<void> {
    const existing = await this.prisma.peecProject.findFirst({
      where: { organizationId },
      orderBy: { lastSyncedAt: 'desc' },
      select: { id: true },
    });
    if (!existing) return;
    await this.prisma.peecProject.update({
      where: { id: existing.id },
      data: { lastSyncError: message.slice(0, 500), lastSyncErrorAt: new Date() },
    });
  }

  private tolerate(name: string) {
    return (err: Error) => {
      this.logger.warn(`${name} failed during sync: ${err.message}`);
      return { columns: [], rows: [], rowCount: 0 };
    };
  }
}

/**
 * Drop the redundant `rowCount`/`total` fields when persisting Peec columnar
 * payloads as JSON — the dashboard cards reshape them on read and only need
 * `{ columns, rows }`. JSON.parse(JSON.stringify(...)) defeats the
 * `unknown[][]` → `Prisma.InputJsonValue` mismatch without a wider cast.
 */
function stripColumnar(resp: { columns: string[]; rows: unknown[][] }): object {
  return JSON.parse(JSON.stringify({ columns: resp.columns, rows: resp.rows }));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
