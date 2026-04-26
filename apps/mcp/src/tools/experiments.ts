/**
 * Experiment lifecycle tools.
 *
 * Reads → Prisma directly (low-latency, works offline-from-API).
 * Mutations → POST to NestJS so the state machine + ExperimentEvent log
 *             remain authoritative.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  parseExperimentYaml,
  type ExperimentYaml,
} from '@peec-lab/shared';
import type { XperiApiClient } from '../api-client.js';
import {
  getDashboardSummary,
  getExperimentDetail,
  listExperiments,
} from '../prisma-reads.js';

const experimentStatusEnum = z.enum([
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'ANALYZING',
  'WIN',
  'LOSS',
  'INCONCLUSIVE',
  'CANCELLED',
  'ERRORED',
]);

interface RegisterArgs {
  api: XperiApiClient;
  organizationId: string;
}

export function registerExperimentTools(
  server: McpServer,
  { api, organizationId }: RegisterArgs,
): void {
  server.registerTool(
    'xperi_list_experiments',
    {
      title: 'List experiments',
      description:
        'List experiments for the demo organization, newest first. Filter ' +
        'by status (DRAFT/SCHEDULED/RUNNING/ANALYZING/WIN/LOSS/INCONCLUSIVE/CANCELLED/ERRORED). ' +
        'Returns each row with id, name, status, hypothesis, treatment URL, share slug, ' +
        'and verdict (when computed).',
      inputSchema: {
        status: experimentStatusEnum.optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ status, limit }) => {
      const rows = await listExperiments(organizationId, { status, limit });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ count: rows.length, rows }, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'xperi_get_experiment',
    {
      title: 'Get experiment detail',
      description:
        'Fetch one experiment with its full event timeline, snapshots ' +
        '(metadata only), and computed result (if any). Use this when you ' +
        'need to explain *why* an experiment is in its current status.',
      inputSchema: {
        id: z.string().min(1).describe('Experiment cuid (returned by xperi_list_experiments).'),
      },
    },
    async ({ id }) => {
      const exp = await getExperimentDetail(organizationId, id);
      if (!exp) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Experiment not found: ${id}` }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(exp, null, 2) }],
      };
    },
  );

  server.registerTool(
    'xperi_create_experiment',
    {
      title: 'Create experiment',
      description:
        'Create a new experiment in DRAFT. Requires the *internal* ' +
        'PeecProject id (use xperi_list_peec_projects to find it) and the ' +
        'Peec prompt ids for both arms (use xperi_list_prompts). The API ' +
        'auto-creates a Peec topic + tag named `experiment:<slug>` so the ' +
        'experiment shows up cleanly inside Peec\'s own dashboards.',
      inputSchema: {
        peecProjectId: z
          .string()
          .min(1)
          .describe('Internal PeecProject.id (cuid). Get it from xperi_list_peec_projects.'),
        name: z.string().min(3).max(160),
        hypothesis: z.string().min(10),
        treatmentUrl: z.string().url(),
        treatmentPromptIds: z
          .array(z.string())
          .min(1)
          .describe('Peec prompt ids for the treatment arm.'),
        controlPromptIds: z
          .array(z.string())
          .min(1)
          .describe('Peec prompt ids for the control arm. Must not overlap with treatment.'),
        engineIds: z
          .array(z.string())
          .optional()
          .describe('Optional engine subset; empty / omitted means "all engines on the project".'),
        minLiftPp: z
          .number()
          .positive()
          .max(100)
          .describe('Minimum detectable effect, in percentage points.'),
        durationDays: z.number().int().min(3).max(28).default(14),
        isPublic: z
          .boolean()
          .default(false)
          .describe('If true, the result page at /r/{slug} is publicly accessible.'),
        shareSlug: z
          .string()
          .optional()
          .describe('Custom slug for the public share URL. Auto-generated if omitted.'),
        randomSeed: z.number().int().nonnegative().default(42),
      },
    },
    async (input) => {
      const created = await api.post<unknown>('/experiments', input);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: true, message: 'Experiment created in DRAFT.', experiment: created },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'xperi_create_experiment_from_yaml',
    {
      title: 'Create experiment from YAML',
      description:
        'Parse an experiment.yaml string and create the experiment in one ' +
        'shot. Same shape used by the GitHub PR webhook — handy for ' +
        'replaying an experiment from the templates folder without going ' +
        'through git. You still need to pass the internal PeecProject id ' +
        'because experiment.yaml does not encode it (it lives in your repo).',
      inputSchema: {
        yaml: z.string().min(1).describe('Raw experiment.yaml file body.'),
        peecProjectId: z
          .string()
          .min(1)
          .describe('Internal PeecProject.id (cuid). Get it from xperi_list_peec_projects.'),
      },
    },
    async ({ yaml, peecProjectId }) => {
      const parsed = parseExperimentYaml(yaml);
      if (!parsed.ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { ok: false, errors: parsed.errors },
                null,
                2,
              ),
            },
          ],
        };
      }
      const body = yamlToCreateBody(parsed.data, peecProjectId);
      const created = await api.post<unknown>('/experiments', body);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, experiment: created }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'xperi_cancel_experiment',
    {
      title: 'Cancel experiment',
      description:
        'Cancel an experiment that is in DRAFT / SCHEDULED / RUNNING / ' +
        'ANALYZING. The API also best-effort deletes the experiment\'s ' +
        'auto-created Peec topic + tag.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const cancelled = await api.post<unknown>(`/experiments/${id}/cancel`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: true, message: 'Experiment cancelled.', experiment: cancelled },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'xperi_refresh_now',
    {
      title: 'Refresh snapshot now',
      description:
        'Force a fresh DAILY snapshot for an experiment without waiting ' +
        'for the once-per-day Hobby cron. Calls Peec\'s get_brand_report / ' +
        'get_url_report / get_domain_report under the hood — typically <5s.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const result = await api.post<unknown>(`/experiments/${id}/refresh-now`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'xperi_dashboard_summary',
    {
      title: 'Dashboard summary',
      description:
        'KPIs for the demo org: number of running experiments, number of ' +
        'WIN verdicts, and cumulative percentage points gained YTD across ' +
        'all statistically-significant wins.',
      inputSchema: {},
    },
    async () => {
      const s = await getDashboardSummary(organizationId);
      return {
        content: [{ type: 'text', text: JSON.stringify(s, null, 2) }],
      };
    },
  );
}

function yamlToCreateBody(yaml: ExperimentYaml, peecProjectId: string) {
  return {
    peecProjectId,
    name: yaml.name,
    hypothesis: yaml.hypothesis,
    treatmentUrl: yaml.treatment_url,
    treatmentPromptIds: yaml.treatment_prompts.map((p) => p.prompt_id),
    controlPromptIds: yaml.control_prompts.map((p) => p.prompt_id),
    engineIds: yaml.engines as string[] | undefined,
    minLiftPp: yaml.min_lift_pp,
    durationDays: yaml.duration_days === 'auto' ? 14 : yaml.duration_days,
    shareSlug: yaml.id,
    isPublic: yaml.share === 'public',
    randomSeed: yaml.seed,
  };
}
