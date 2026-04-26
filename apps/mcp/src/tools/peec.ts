/**
 * Peec lookup tools — surface the resource pickers the experiment-create
 * wizard uses (projects, prompts, brands, models, topics, tags) so an LLM
 * agent in Cursor can compose a `xperi_create_experiment` call without the
 * user pasting opaque cuids.
 *
 * All reads come from the local cache (Prisma) populated by PeecSyncService —
 * remind the user to run a sync first if the cache is empty / stale.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { XperiApiClient } from '../api-client.js';
import { listCachedPrompts, listPeecProjects } from '../prisma-reads.js';

interface RegisterArgs {
  api: XperiApiClient;
  organizationId: string;
}

export function registerPeecTools(
  server: McpServer,
  { api, organizationId }: RegisterArgs,
): void {
  server.registerTool(
    'xperi_list_peec_projects',
    {
      title: 'List connected Peec projects',
      description:
        'Lists Peec projects already connected and cached for this org. ' +
        'Returns both the *internal* PeecProject.id (use this when calling ' +
        'xperi_create_experiment) AND the upstream `peecProjectId` (use ' +
        'this when calling raw Peec MCP tools).',
      inputSchema: {},
    },
    async () => {
      const rows = await listPeecProjects(organizationId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: rows.length,
                rows,
                hint:
                  rows.length === 0
                    ? 'No Peec projects cached yet. Run xperi_sync_peec to fetch them, or open /integrations in the web app.'
                    : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'xperi_list_prompts',
    {
      title: 'List cached Peec prompts',
      description:
        'List the cached prompts for the most-recently-synced Peec project ' +
        '(or a specific project, by internal PeecProject.id). Returns ' +
        '`{ id, text }` so an agent can pick treatment/control prompt ids ' +
        'without scanning opaque cuids.',
      inputSchema: {
        peecProjectId: z
          .string()
          .optional()
          .describe('Internal PeecProject.id (cuid). Omit for the most-recent project.'),
        limit: z.number().int().min(1).max(500).default(100),
      },
    },
    async ({ peecProjectId, limit }) => {
      const prompts = await listCachedPrompts(organizationId, peecProjectId, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: prompts.length,
                prompts,
                hint:
                  prompts.length === 0
                    ? 'No prompts cached. Run xperi_sync_peec first, or check that the Peec project is connected.'
                    : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'xperi_peec_status',
    {
      title: 'Peec MCP connection status',
      description:
        'Check whether the API has a live Peec OAuth token. Returns ' +
        '`{ mode: "live" | "disconnected", baseUrl }`. If disconnected, ' +
        'the user needs to open /integrations in the web app and reconnect.',
      inputSchema: {},
    },
    async () => {
      const r = await api.get<{ mode: string; baseUrl: string }>('/peec/status');
      return {
        content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
      };
    },
  );

  server.registerTool(
    'xperi_sync_peec',
    {
      title: 'Sync Peec data into the local cache',
      description:
        'Refresh the local cache of Peec projects, prompts, brands, ' +
        'topics, tags, and analytics. Mirrors the "Refresh from Peec" ' +
        'button on the dashboard. Idempotent.',
      inputSchema: {},
    },
    async () => {
      const r = await api.post<unknown>('/peec/sync');
      return {
        content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
      };
    },
  );
}
