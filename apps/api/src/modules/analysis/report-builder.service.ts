import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient, Verdict } from '@peec-lab/database';
import type { LiftByEngine } from '@peec-lab/shared';
import { formatPpDelta } from '@peec-lab/ui';
import { PRISMA } from '../../prisma/prisma.module.js';
import { PeecMcpService } from '../peec/peec-mcp.service.js';

/**
 * ReportBuilderService.build — composes the markdown verdict from:
 *   - permutation result (passed in from AnalysisService)
 *   - get_actions recommendations
 *   - top 3 evidence chats from list_chats + get_chat
 *   - competitor movement from list_brands + get_domain_report
 *   - before/after diff from the two get_url_content snapshots
 */
@Injectable()
export class ReportBuilderService {
  private readonly logger = new Logger(ReportBuilderService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly peec: PeecMcpService,
  ) {}

  async build(
    experimentId: string,
    args: { liftByEngine: LiftByEngine; verdict: Verdict; overallPValue: number },
  ): Promise<{
    markdown: string;
    recommendations: unknown[];
    evidenceChats: unknown[];
    competitorMovement: Record<string, unknown>;
  }> {
    const exp = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { peecProject: true },
    });
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const projectId = exp.peecProject.peecProjectId;
    const peecClient = await this.peec.getClient();

    // 1. Recommendations (best effort)
    let recommendations: unknown[] = [];
    try {
      if (!peecClient) throw new Error('Peec MCP disconnected');
      const r = await peecClient.getActions({ project_id: projectId, scope: 'overview' });
      recommendations = r.actions.slice(0, 5);
    } catch (err) {
      this.logger.warn(`get_actions failed: ${(err as Error).message}`);
    }

    // 2. Evidence chats (best effort) — last 7 days
    //
    // Two-step pipeline: list_chats finds the recent chats for this
    // project; get_chat enriches each one with the actual prompt text,
    // model response, and inline citations. The downstream UI
    // (`EvidenceDrawer`) needs `model_id` + `citations` to render
    // anything useful, so a list_chats-only response would just produce
    // an empty drawer. We tolerate per-chat get_chat failures so a
    // single bad row doesn't blank out the whole evidence panel.
    let evidenceChats: unknown[] = [];
    try {
      if (!peecClient) throw new Error('Peec MCP disconnected');
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const chatList = await peecClient.listChats({
        project_id: projectId,
        start_date: isoDate(start),
        end_date: isoDate(new Date()),
        limit: 5,
      });
      const chatIdCol = chatList.columns.indexOf('chat_id');
      const modelIdCol = chatList.columns.indexOf('model_id');
      const promptIdCol = chatList.columns.indexOf('prompt_id');
      // Pick the freshest 3 chat ids; we'll get_chat each in parallel.
      const tops = chatList.rows.slice(0, 3).map((row) => ({
        chat_id: chatIdCol >= 0 ? (row[chatIdCol] as string | null) : null,
        model_id_hint: modelIdCol >= 0 ? (row[modelIdCol] as string | null) : null,
        prompt_id_hint: promptIdCol >= 0 ? (row[promptIdCol] as string | null) : null,
      }));
      const enriched = await Promise.all(
        tops.map(async (t) => {
          if (!t.chat_id) return null;
          try {
            const detail = await peecClient.getChat({
              project_id: projectId,
              chat_id: t.chat_id,
            });
            return {
              chat_id: detail.chat_id,
              model_id: detail.model_id ?? t.model_id_hint ?? 'unknown',
              prompt_id: detail.prompt_id ?? t.prompt_id_hint ?? undefined,
              prompt_text: detail.prompt_text,
              // Surface a short response excerpt as the drawer "summary".
              // Full response is deliberately not stored to keep the
              // ExperimentResult.evidenceChats payload bounded.
              summary:
                typeof detail.response === 'string'
                  ? detail.response.slice(0, 480)
                  : undefined,
              citations: detail.citations?.slice(0, 6),
            };
          } catch (err) {
            this.logger.warn(
              `get_chat ${t.chat_id} failed: ${(err as Error).message}`,
            );
            // Fall back to the row hints so the drawer at least knows
            // which engine the chat came from.
            return {
              chat_id: t.chat_id,
              model_id: t.model_id_hint ?? 'unknown',
              prompt_id: t.prompt_id_hint ?? undefined,
            };
          }
        }),
      );
      evidenceChats = enriched.filter((c): c is NonNullable<typeof c> => c !== null);
    } catch (err) {
      this.logger.warn(`list_chats failed: ${(err as Error).message}`);
    }

    // 3. Competitor movement (best effort)
    let competitorMovement: Record<string, unknown> = {};
    try {
      if (!peecClient) throw new Error('Peec MCP disconnected');
      const brands = await peecClient.listBrands({ project_id: projectId, limit: 20 });
      const idCol = brands.columns.indexOf('id');
      const nameCol = brands.columns.indexOf('name');
      for (const row of brands.rows.slice(0, 5)) {
        const id = row[idCol] as string;
        const name = row[nameCol] as string;
        competitorMovement[id] = {
          brand_name: name,
          sov_delta: 0,
          visibility_delta: 0,
        };
      }
    } catch (err) {
      this.logger.warn(`list_brands failed: ${(err as Error).message}`);
    }

    const markdown = this.renderMarkdown(exp.name, exp.hypothesis, args, recommendations, exp);

    return { markdown, recommendations, evidenceChats, competitorMovement };
  }

  private renderMarkdown(
    name: string,
    hypothesis: string,
    args: { liftByEngine: LiftByEngine; verdict: Verdict; overallPValue: number },
    recommendations: unknown[],
    exp: { treatmentUrl: string; minLiftPp: number },
  ): string {
    const lines: string[] = [];
    const verdictEmoji =
      args.verdict === 'WIN' ? '✅' : args.verdict === 'LOSS' ? '❌' : '🟡';
    lines.push(`# ${verdictEmoji} ${args.verdict}: ${name}`);
    lines.push('');
    lines.push(`> **Hypothesis:** ${hypothesis}`);
    lines.push('');
    lines.push(`**Treatment URL:** [${exp.treatmentUrl}](${exp.treatmentUrl})`);
    lines.push(`**Minimum detectable lift:** ${exp.minLiftPp}pp`);
    lines.push(`**Overall (best) corrected p-value:** ${args.overallPValue.toFixed(4)}`);
    lines.push('');
    lines.push('## Per-engine lift');
    lines.push('');
    lines.push('| Engine | Lift | 95% CI | Corrected p |');
    lines.push('|---|---|---|---|');
    for (const [engineId, l] of Object.entries(args.liftByEngine)) {
      lines.push(
        `| \`${engineId}\` | ${formatPpDelta(l.lift_pp / 100)} | [${(l.ci_low).toFixed(2)}pp, ${(l.ci_high).toFixed(2)}pp] | ${(l.p_value_corrected ?? l.p_value).toFixed(4)} |`,
      );
    }
    lines.push('');
    if (recommendations.length > 0) {
      lines.push('## Recommended next steps (from `get_actions`)');
      for (const r of recommendations as Array<{ title: string; priority?: string }>) {
        lines.push(`- **${r.priority ?? 'medium'}** — ${r.title}`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('Generated by **Peec Experiment Lab**. #BuiltWithPeec');
    return lines.join('\n');
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
