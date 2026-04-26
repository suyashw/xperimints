import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient, SnapshotKind } from '@peec-lab/database';
import { decodeRows } from '@peec-lab/mcp-clients';
import { PRISMA } from '../../prisma/prisma.module.js';
import { PeecMcpService } from '../peec/peec-mcp.service.js';

interface BrandRow extends Record<string, unknown> {
  prompt_id?: string;
  model_id?: string;
  visibility?: number;
  share_of_voice?: number;
  sentiment?: number;
  position?: number;
  mention_count?: number;
}

/**
 * SnapshotService.captureFor — call get_brand_report + get_url_report +
 * get_domain_report + get_url_content (the latter only on baseline / final),
 * fold the columnar responses into our per-(prompt, engine) cell shape, and
 * persist as one ExperimentSnapshot row.
 *
 * See PLAN.md §5.6 — this is the unit of work the daily Vercel Workflow
 * step runs. It must finish well under 60s; for typical experiments the calls
 * are ~3 sequential MCP roundtrips plus one DB write.
 */
@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger(SnapshotsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly peec: PeecMcpService,
  ) {}

  async captureFor(experimentId: string, kind: SnapshotKind = 'DAILY') {
    const exp = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { peecProject: true },
    });
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const peecProjectId = exp.peecProject.peecProjectId;
    const allPromptIds = [...exp.treatmentPromptIds, ...exp.controlPromptIds];
    const today = new Date();
    const start = isoDate(addDays(today, -1));
    const end = isoDate(today);

    const peecClient = await this.peec.requireClient();
    const brandResp = await peecClient.getBrandReport({
      project_id: peecProjectId,
      start_date: start,
      end_date: end,
      dimensions: ['prompt_id', 'model_id'],
      filters: [
        { field: 'prompt_id', operator: 'in', values: allPromptIds },
        ...(exp.engineIds.length > 0
          ? [{ field: 'model_id' as const, operator: 'in' as const, values: exp.engineIds }]
          : []),
      ],
    });

    const brandMetrics = brandRowsToCellMatrix(decodeRows<BrandRow>(brandResp));

    const [urlResp, domainResp] = await Promise.all([
      peecClient
        .getUrlReport({
          project_id: peecProjectId,
          start_date: start,
          end_date: end,
        })
        .catch((err: Error) => {
          this.logger.warn(`get_url_report failed: ${err.message}`);
          return { columns: [], rows: [], rowCount: 0 };
        }),
      peecClient
        .getDomainReport({
          project_id: peecProjectId,
          start_date: start,
          end_date: end,
        })
        .catch((err: Error) => {
          this.logger.warn(`get_domain_report failed: ${err.message}`);
          return { columns: [], rows: [], rowCount: 0 };
        }),
    ]);

    return this.prisma.experimentSnapshot.create({
      data: {
        experimentId,
        capturedAt: new Date(),
        kind,
        brandMetrics: brandMetrics as object,
        urlMetrics: JSON.parse(JSON.stringify({ columns: urlResp.columns, rows: urlResp.rows })),
        domainMetrics: JSON.parse(
          JSON.stringify({ columns: domainResp.columns, rows: domainResp.rows }),
        ),
      },
    });
  }

  async snapshotTreatmentUrlContent(experimentId: string, when: 'before' | 'after') {
    const exp = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { peecProject: true },
    });
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);
    try {
      const peecClient = await this.peec.requireClient();
      const res = await peecClient.getUrlContent({
        project_id: exp.peecProject.peecProjectId,
        url: exp.treatmentUrl,
      });
      const update = when === 'before'
        ? { treatmentUrlSnapshotBefore: res.content ?? null }
        : { treatmentUrlSnapshotAfter: res.content ?? null };
      await this.prisma.experiment.update({ where: { id: experimentId }, data: update });
      return res;
    } catch (err) {
      this.logger.warn(
        `get_url_content for ${exp.treatmentUrl} failed (${when}): ${(err as Error).message}`,
      );
      return null;
    }
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function brandRowsToCellMatrix(
  rows: BrandRow[],
): Record<string, Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of rows) {
    if (!r.prompt_id || !r.model_id) continue;
    out[r.prompt_id] = out[r.prompt_id] ?? {};
    out[r.prompt_id]![r.model_id] = pruneUndefined({
      visibility: r.visibility,
      share_of_voice: r.share_of_voice,
      sentiment: r.sentiment,
      position: r.position,
      mention_count: r.mention_count,
    });
  }
  return out;
}

function pruneUndefined<T extends Record<string, unknown>>(o: T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
